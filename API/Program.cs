using API.Data;
using API.Endpoints;
using API.Entities;
using API.Hubs;
using API.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var JwtSettings = builder.Configuration.GetSection("Jwt");
// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddDbContext<AppDbcontext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:4200", "https://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.Services.AddIdentityCore<AppUser>()
    .AddEntityFrameworkStores<AppDbcontext>()
    .AddDefaultTokenProviders();

builder.Services.AddScoped<TokenService>();
builder.Services.AddSingleton<ChatFileService>();
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 30 * 1024 * 1024;
});
builder.Services.AddSignalR();
builder.Services.AddSingleton<IUserIdProvider, ClaimsUserIdProvider>();

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options =>
{
    options.SaveToken = true;
    options.RequireHttpsMetadata = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new  SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(JwtSettings.GetSection("Key").Value!))
    };

    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];
            var path = context.HttpContext.Request.Path;
            if (!string.IsNullOrEmpty(accessToken) && 
                (path.StartsWithSegments("/hubs") || path.StartsWithSegments("/chatHub")))
            {
                context.Token = accessToken;
            }
            return Task.CompletedTask;
        }
    };
});




var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
app.UseCors(x=>x.AllowAnyHeader().AllowAnyMethod().WithOrigins("http://localhost:4200")
        .AllowCredentials());
// app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapAccountEndpoints();
app.MapChatFileEndpoints();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/chat-files", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    await next();
});
app.UseStaticFiles();
app.MapHub<ChatHub>("hubs/chat");
app.MapHub<ChatHub>("chatHub");
app.MapHub<VideoHub>("/hubs/video");
app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
