using System.Net.Http.Json;
using System.Text.Json;
using Center.Domain;
using Npgsql;

namespace Center.Infrastructure;

public enum Module { Identity, People, Education, Work, Import, Documents }

public sealed class State(NpgsqlDataSource db, IConfiguration config, IHttpClientFactory clients)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public string Mode => config["CENTER_SERVICE"] ?? "all";
    public bool RequireMfa => !config.GetValue<bool>("CENTER_DEMO") || config.GetValue<bool>("CENTER_TEST_MFA");
    public string Key => config["CENTER_INTERNAL_KEY"] ?? "";
    public bool Local(Module module) => Mode == "all" || Mode.Equals(module.ToString(), StringComparison.OrdinalIgnoreCase);
    public Uri Address(Module module) => new(config[$"CENTER_{module.ToString().ToUpperInvariant()}_URL"] ?? $"http://{module.ToString().ToLowerInvariant()}:8080");
    private static string Table(Module module) => module.ToString().ToLowerInvariant() + ".state";
    private void Own(Module module)
    {
        if (!Local(module)) throw new InvalidOperationException("Only the owner can query this schema.");
    }
    public async Task Init()
    {
        foreach (var module in Enum.GetValues<Module>().Where(Local).Where(x => x is not (Module.Import or Module.Documents)))
        {
            var name = module.ToString().ToLowerInvariant();
            var schema = Mode == "all" ? $"CREATE SCHEMA IF NOT EXISTS {name};" : "";
            await using var command = db.CreateCommand($"""
                {schema}
                CREATE TABLE IF NOT EXISTS {Table(module)} (
                  center uuid PRIMARY KEY,
                  data jsonb NOT NULL,
                  updated_at timestamptz NOT NULL DEFAULT now()
                );
                """);
            await command.ExecuteNonQueryAsync();
        }
    }
    public async Task<T> Read<T>(Module module, Guid center) where T : new()
    {
        if (!Local(module))
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(Address(module), $"/internal/state/{center}"));
            request.Headers.Add("X-Center-Internal", Key);
            using var response = await clients.CreateClient("internal").SendAsync(request);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<T>(Json) ?? new T();
        }
        await using var command = db.CreateCommand($"SELECT data::text FROM {Table(module)} WHERE center = $1");
        command.Parameters.AddWithValue(center);
        var raw = (string?)await command.ExecuteScalarAsync();
        return raw is null ? new T() : JsonSerializer.Deserialize<T>(raw, Json)!;
    }
    public async Task<TResult> Change<T, TResult>(Module module, Guid center, Func<T, TResult> edit) where T : new() =>
        await Change<T, TResult>(module, center, value => Task.FromResult(edit(value)));
    public async Task<TResult> Change<T, TResult>(Module module, Guid center, Func<T, Task<TResult>> edit) where T : new()
    {
        Own(module);
        await using var connection = await db.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var create = new NpgsqlCommand($"INSERT INTO {Table(module)} (center, data) VALUES ($1, '{{}}') ON CONFLICT DO NOTHING", connection, transaction))
        {
            create.Parameters.AddWithValue(center);
            await create.ExecuteNonQueryAsync();
        }
        T data;
        await using (var select = new NpgsqlCommand($"SELECT data::text FROM {Table(module)} WHERE center = $1 FOR UPDATE", connection, transaction))
        {
            select.Parameters.AddWithValue(center);
            data = JsonSerializer.Deserialize<T>((string)(await select.ExecuteScalarAsync())!, Json)!;
        }
        var result = await edit(data);
        await using (var update = new NpgsqlCommand($"UPDATE {Table(module)} SET data = $2::jsonb, updated_at = now() WHERE center = $1", connection, transaction))
        {
            update.Parameters.AddWithValue(center);
            update.Parameters.AddWithValue(JsonSerializer.Serialize(data, Json));
            await update.ExecuteNonQueryAsync();
        }
        await transaction.CommitAsync();
        return result;
    }
    public async Task<T> Send<T>(Module module, string path, object payload)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(Address(module), path));
        request.Headers.Add("X-Center-Internal", Key);
        request.Content = JsonContent.Create(payload, options: Json);
        using var response = await clients.CreateClient("internal").SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            throw new DomainException(body.RootElement.GetProperty("error").GetString()!, (int)response.StatusCode);
        }
        return (await response.Content.ReadFromJsonAsync<T>(Json))!;
    }
}
