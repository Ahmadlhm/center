using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Center.Domain;
using Center.Features;
using Center.Infrastructure;
using Fido2NetLib;
using Microsoft.AspNetCore.Http.Features;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
var mode = config["CENTER_SERVICE"] ?? "all";
var origin = new Uri(config["CENTER_ORIGIN"] ?? "http://localhost:5173");
if (mode != "all" && (config["CENTER_INTERNAL_KEY"]?.Length ?? 0) < 32)
    throw new InvalidOperationException("CENTER_INTERNAL_KEY must have at least 32 characters.");
if (config.GetValue<bool>("CENTER_DEMO") && !origin.IsLoopback)
    throw new InvalidOperationException("Demo accounts are for loopback use only.");
if (!config.GetValue<bool>("CENTER_ALLOW_HTTP") && origin.Scheme != "https")
    throw new InvalidOperationException("Set CENTER_ORIGIN to an HTTPS origin, or explicitly enable local HTTP.");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 12 * 1024 * 1024);
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 10 * 1024 * 1024;
    options.MemoryBufferThreshold = 11 * 1024 * 1024;
});
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(config["CENTER_DB"] ??
    "Host=127.0.0.1;Port=55432;Database=center;Username=center_local"));
builder.Services.AddHttpClient("internal", c => c.Timeout = TimeSpan.FromSeconds(120)).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false });
builder.Services.AddSingleton<State>();
if (mode is "education" or "all") builder.Services.AddHostedService<MeetingPlanner>();
builder.Services.AddSingleton<IFido2>(_ => new Fido2(new Fido2Configuration
{
    ServerDomain = origin.Host,
    ServerName = "Quran Centers",
    Origins = new HashSet<string>([origin.GetLeftPart(UriPartial.Authority)])
}));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("public", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 35, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();
var store = app.Services.GetRequiredService<State>();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.Headers.CacheControl = "no-store";
    try
    {
        if (ctx.Request.Path.StartsWithSegments("/internal"))
        {
            var header = ctx.Request.Headers["X-Center-Internal"].ToString();
            Rules.Require(store.Key.Length >= 32 && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(header), Encoding.UTF8.GetBytes(store.Key)),
                "الوصول مقيّد.", 403);
        }
        if (ctx.Request.Path.StartsWithSegments("/api") && ctx.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
            Rules.Require(ctx.Request.Headers.Origin.ToString() == origin.GetLeftPart(UriPartial.Authority),
                "أعد فتح المنصة من عنوانها المعتمد.", 403);
        await next();
    }
    catch (Exception error) when (!ctx.Response.HasStarted)
    {
        var status = error switch
        {
            DomainException fault => fault.Status, FormatException or ArgumentException or TimeZoneNotFoundException or InvalidDataException => 400,
            Fido2VerificationException => 400, BadHttpRequestException bad => bad.StatusCode,
            OperationCanceledException => 408, HttpRequestException or NpgsqlException => 503, _ => 500
        };
        if (status >= 500) app.Logger.LogError("Request {Method} failed with {ExceptionType}; trace {Trace}", ctx.Request.Method, error.GetType().Name, ctx.TraceIdentifier);
        ctx.Response.StatusCode = status;
        await ctx.Response.WriteAsJsonAsync(new { error = error is DomainException fault2 ? fault2.Message :
            status == 400 ? "تعذّرت قراءة المدخلات أو التحقق منها." :
            status == 408 ? "انتهت مهلة العملية." : "تعذّر إكمال العملية. حاول مرة أخرى." });
    }
});
app.UseRateLimiter();
app.MapGet("/health", () => new { status = "ok", service = mode });
if (mode == "gateway")
{
    app.Map("/api/{**path}", async (HttpContext ctx, IHttpClientFactory factory) =>
    {
        var parts = ctx.Request.Path.Value!.Split('/', StringSplitOptions.RemoveEmptyEntries);
        Module? module = parts.ElementAtOrDefault(1) switch
        {
            "auth" => Module.Identity,
            "centers" => parts.ElementAtOrDefault(3) switch
            {
                "identity" => Module.Identity, "people" => Module.People, "education" => Module.Education,
                "work" => Module.Work, "import" => Module.Import, "documents" => Module.Documents, _ => null
            },
            _ => null
        };
        Rules.Require(module.HasValue, "المسار غير متاح.", 404);
        var url = new Uri(store.Address(module!.Value), ctx.Request.Path + ctx.Request.QueryString);
        using var request = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), url);
        if (ctx.Request.Method is "POST" or "PUT" or "PATCH")
        {
            request.Content = new StreamContent(ctx.Request.Body);
            if (ctx.Request.ContentType is { } type) request.Content.Headers.TryAddWithoutValidation("Content-Type", type);
        }
        foreach (var header in new[] { "Cookie", "Origin", "Accept" })
            if (ctx.Request.Headers.TryGetValue(header, out var value)) request.Headers.TryAddWithoutValidation(header, value.AsEnumerable());
        using var response = await factory.CreateClient("internal").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
        ctx.Response.StatusCode = (int)response.StatusCode;
        foreach (var header in response.Headers.Concat(response.Content.Headers))
            if (header.Key is "Content-Type" or "Content-Disposition" or "Set-Cookie" or "Cache-Control" or "Retry-After")
                ctx.Response.Headers[header.Key] = header.Value.ToArray();
        await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
    });
}
else
{
    if (store.Local(Module.Identity)) { Identity.Map(app); Passkeys.Map(app); }
    if (store.Local(Module.People)) People.Map(app);
    if (store.Local(Module.Education)) { Education.Map(app); Transfers.MapReports(app); }
    if (store.Local(Module.Work)) Work.Map(app);
    if (store.Local(Module.Import)) Transfers.MapImports(app);
    if (store.Local(Module.Documents)) Certificates.Map(app);
    if (mode != "all" && Enum.TryParse<Module>(mode, true, out var module) && module is not (Module.Import or Module.Documents or Module.Identity))
        app.MapGet("/internal/state/{center:guid}", async (Guid center, State store) => module switch
        {
            Module.People => Results.Json(await store.Read<PeopleData>(module, center)),
            Module.Education => Results.Json(await store.Read<EducationData>(module, center)),
            Module.Work => Results.Json(await store.Read<WorkData>(module, center)),
            _ => Results.NotFound()
        });
    await store.Init();
    if (store.Local(Module.Documents)) await Certificates.Init(app.Services.GetRequiredService<NpgsqlDataSource>(), mode == "all");
    await Identity.Initialize(store, config);
    if (config.GetValue<bool>("CENTER_DEMO")) await Demo.Initialize(store);
}
await app.RunAsync();
