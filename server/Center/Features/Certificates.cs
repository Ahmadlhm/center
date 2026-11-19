using Center.Domain;
using Center.Infrastructure;
using Npgsql;

namespace Center.Features;

public static class Certificates
{
    private const int MaxBytes = 10 * 1024 * 1024;
    public static async Task Init(NpgsqlDataSource db, bool createSchema)
    {
        var schema = createSchema ? "CREATE SCHEMA IF NOT EXISTS documents;" : "";
        await using var cmd = db.CreateCommand($"""
            {schema}
            CREATE TABLE IF NOT EXISTS documents.certificates (
              center uuid NOT NULL, id uuid NOT NULL, group_id uuid NOT NULL, student_id uuid,
              title text NOT NULL, category text NOT NULL, name text NOT NULL, content_type text NOT NULL,
              size integer NOT NULL, content bytea NOT NULL, uploaded_at timestamptz NOT NULL, uploaded_by uuid NOT NULL,
              PRIMARY KEY(center, id)
            );
            CREATE TABLE IF NOT EXISTS documents.audit (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, center uuid NOT NULL,
              certificate uuid NOT NULL, actor uuid NOT NULL, action text NOT NULL, at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS certificates_group ON documents.certificates(center, group_id);
            CREATE INDEX IF NOT EXISTS certificates_student ON documents.certificates(center, student_id);
            """);
        await cmd.ExecuteNonQueryAsync();
    }
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/documents");
        g.MapGet("", async (Guid center, Guid? group, Guid? student, HttpContext http, State store, NpgsqlDataSource db) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var day = Rules.Today(info.TimeZone);
            Rules.Require(group.HasValue != student.HasValue, "اختر شعبة أو طالبًا.");
            if (group is Guid groupId)
                Rules.Require(people.GroupAt(groupId, day) is { } target && actor.CanSee(people, target), "مجلد الشعبة خارج صلاحيتك.", 403);
            if (student is Guid studentId)
                Rules.Require(People.CanSeeStudent(actor, people, studentId, day), "ملف الطالب خارج صلاحيتك.", 403);
            await using var cmd = db.CreateCommand($"SELECT id,group_id,student_id,title,category,name,content_type,size,uploaded_at FROM documents.certificates WHERE center=$1 AND {(group.HasValue ? "group_id" : "student_id")}=$2 ORDER BY uploaded_at DESC");
            cmd.Parameters.AddWithValue(center);
            cmd.Parameters.AddWithValue(group ?? student!.Value);
            await using var reader = await cmd.ExecuteReaderAsync();
            var result = new List<Item>();
            while (await reader.ReadAsync())
            {
                var row = Read(reader);
                if (group.HasValue || (student.HasValue && People.FullStudent(actor, people, student.Value, day)) ||
                    (people.GroupAt(row.Group, day) is { } unitGroup && actor.Manager && people.InScope(unitGroup.Unit, actor.Units)))
                    result.Add(row);
            }
            return result;
        });
        g.MapPost("", async (Guid center, HttpContext http, State store, NpgsqlDataSource db) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var form = await http.Request.ReadFormAsync(http.RequestAborted);
            Rules.Require(Guid.TryParse(form["group"], out var groupId), "اختر الشعبة.");
            var target = Rules.Found(people.GroupAt(groupId, Rules.Today(info.TimeZone)));
            Rules.Require(actor.Admin || (actor.Teacher && target.Teacher == actor.Id), "لا يمكنك الرفع في هذه الشعبة.", 403);
            Guid? student = Guid.TryParse(form["student"], out var studentId) ? studentId : null;
            Rules.Require(student is null || (people.Students.Any(x => x.Id == student) && people.Enrollments.Any(x => x.Student == student && x.Group == groupId)), "الطالب ليس ضمن سجل الشعبة.");
            var category = form["category"].ToString();
            Rules.Require(category is "recitation" or "competition", "اختر نوع الشهادة.");
            var title = Rules.Required(form["title"]);
            var file = form.Files.GetFile("file");
            Rules.Require(file is { Length: > 0 and <= MaxBytes }, "ارفع ملف شهادة حتى ١٠ ميغابايت.");
            await using var memory = new MemoryStream();
            await file!.CopyToAsync(memory, http.RequestAborted);
            var content = memory.ToArray();
            var type = Detect(content);
            var item = new Item(Guid.NewGuid(), groupId, student, title, category, Path.GetFileName(file.FileName.Replace('\\', '/')), type, content.Length, DateTimeOffset.UtcNow);
            await using var connection = await db.OpenConnectionAsync(http.RequestAborted);
            await using var tx = await connection.BeginTransactionAsync(http.RequestAborted);
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO documents.certificates(center,id,group_id,student_id,title,category,name,content_type,size,content,uploaded_at,uploaded_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                """, connection, tx);
            cmd.Parameters.AddWithValue(center);
            cmd.Parameters.AddWithValue(item.Id);
            cmd.Parameters.AddWithValue(groupId);
            cmd.Parameters.Add(new NpgsqlParameter<Guid?> { TypedValue = student, NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid });
            cmd.Parameters.AddWithValue(title);
            cmd.Parameters.AddWithValue(category);
            cmd.Parameters.AddWithValue(Rules.Required(item.Name, 255));
            cmd.Parameters.AddWithValue(type);
            cmd.Parameters.AddWithValue(content.Length);
            cmd.Parameters.AddWithValue(content);
            cmd.Parameters.AddWithValue(item.UploadedAt);
            cmd.Parameters.AddWithValue(actor.Id);
            await cmd.ExecuteNonQueryAsync(http.RequestAborted);
            await Log(connection, tx, center, item.Id, actor.Id, "upload");
            await tx.CommitAsync(http.RequestAborted);
            return item;
        });
        g.MapGet("/{id:guid}/file", async (Guid center, Guid id, HttpContext http, State store, NpgsqlDataSource db) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var today = Rules.Today(info.TimeZone);
            await using var cmd = db.CreateCommand("SELECT id,group_id,student_id,title,category,name,content_type,size,uploaded_at,content FROM documents.certificates WHERE center=$1 AND id=$2");
            cmd.Parameters.AddWithValue(center);
            cmd.Parameters.AddWithValue(id);
            await using var reader = await cmd.ExecuteReaderAsync(http.RequestAborted);
            Rules.Require(await reader.ReadAsync(), "الشهادة غير متاحة.", 404);
            var item = Read(reader);
            Rules.Require((people.GroupAt(item.Group, today) is { } group && actor.CanSee(people, group)) ||
                (item.Student is Guid student && People.CanSeeStudent(actor, people, student, today)), "الشهادة خارج صلاحيتك.", 403);
            return Results.File(reader.GetFieldValue<byte[]>(9), item.ContentType, item.Name);
        });
        g.MapPut("/{id:guid}", async (Guid center, Guid id, Link input, HttpContext http, State store, NpgsqlDataSource db) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var title = Rules.Required(input.Title);
            Rules.Require(input.Category is "recitation" or "competition", "اختر نوع الشهادة.");
            await using var connection = await db.OpenConnectionAsync(http.RequestAborted);
            await using var tx = await connection.BeginTransactionAsync(http.RequestAborted);
            await using var lookup = new NpgsqlCommand("SELECT group_id FROM documents.certificates WHERE center=$1 AND id=$2 FOR UPDATE", connection, tx);
            lookup.Parameters.AddWithValue(center);
            lookup.Parameters.AddWithValue(id);
            var result = await lookup.ExecuteScalarAsync(http.RequestAborted);
            Rules.Require(result is Guid, "الشهادة غير متاحة.", 404);
            var groupId = (Guid)result!;
            var group = Rules.Found(people.GroupAt(groupId, Rules.Today(info.TimeZone)));
            Rules.Require(actor.Admin || (actor.Teacher && group.Teacher == actor.Id), "لا يمكنك تعديل هذه الشهادة.", 403);
            Rules.Require(input.Student is null || people.Enrollments.Any(x => x.Student == input.Student && x.Group == groupId), "الطالب ليس ضمن سجل الشعبة.");
            await using var cmd = new NpgsqlCommand("UPDATE documents.certificates SET title=$3,category=$4,student_id=$5 WHERE center=$1 AND id=$2", connection, tx);
            cmd.Parameters.AddWithValue(center);
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(title);
            cmd.Parameters.AddWithValue(input.Category);
            cmd.Parameters.Add(new NpgsqlParameter<Guid?> { TypedValue = input.Student, NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid });
            await cmd.ExecuteNonQueryAsync(http.RequestAborted);
            await Log(connection, tx, center, id, actor.Id, "link");
            await tx.CommitAsync(http.RequestAborted);
            return Results.NoContent();
        });
        g.MapDelete("/{id:guid}", async (Guid center, Guid id, HttpContext http, State store, NpgsqlDataSource db) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            await using var connection = await db.OpenConnectionAsync(http.RequestAborted);
            await using var tx = await connection.BeginTransactionAsync(http.RequestAborted);
            await using var cmd = new NpgsqlCommand("DELETE FROM documents.certificates WHERE center=$1 AND id=$2", connection, tx);
            cmd.Parameters.AddWithValue(center);
            cmd.Parameters.AddWithValue(id);
            Rules.Require(await cmd.ExecuteNonQueryAsync(http.RequestAborted) == 1, "الشهادة غير متاحة.", 404);
            await Log(connection, tx, center, id, actor.Id, "delete");
            await tx.CommitAsync(http.RequestAborted);
            return Results.NoContent();
        });
    }
    private static async Task Log(NpgsqlConnection connection, NpgsqlTransaction tx, Guid center, Guid id, Guid actor, string action)
    {
        await using var cmd = new NpgsqlCommand("INSERT INTO documents.audit (center, certificate, actor, action) VALUES ($1,$2,$3,$4)", connection, tx);
        cmd.Parameters.AddWithValue(center);
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(actor);
        cmd.Parameters.AddWithValue(action);
        await cmd.ExecuteNonQueryAsync();
    }
    public record Link(string Title, string Category, Guid? Student);
    private static string Detect(byte[] content)
    {
        if (content.AsSpan().StartsWith("%PDF-"u8)) return "application/pdf";
        if (content.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (content.AsSpan().StartsWith(new byte[] { 255, 216, 255 })) return "image/jpeg";
        throw new DomainException("يمكن رفع PDF أو PNG أو JPEG.");
    }
    private static Item Read(NpgsqlDataReader row) => new(row.GetGuid(0), row.GetGuid(1), row.IsDBNull(2) ? null : row.GetGuid(2), row.GetString(3),
        row.GetString(4), row.GetString(5), row.GetString(6), row.GetInt32(7), row.GetFieldValue<DateTimeOffset>(8));
    public record Item(Guid Id, Guid Group, Guid? Student, string Title, string Category, string Name, string ContentType, int Size, DateTimeOffset UploadedAt);
}
