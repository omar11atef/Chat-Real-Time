using API.Entities;
using API.Common;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using API.Services;
using API.Extenions;
using Microsoft.EntityFrameworkCore;
using API.Data;
using API.Hubs;

namespace API.Endpoints;

public static class AccountEndpoint
{
    public static RouteGroupBuilder MapAccountEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/account").WithTags("account");
            group.MapPost("/register", async (HttpContext httpContext, UserManager<AppUser> userManager ,
            [FromForm] string fullname,[FromForm] string email, [FromForm] string password,[FromForm] string username
            ,[FromForm] IFormFile? profilePicture) =>
        {
            var userByEmail = await userManager.FindByEmailAsync(email);
            if (userByEmail != null)
                return Results.BadRequest(Common.Response<string>.Failure("Email already exists"));

            var userByName = await userManager.FindByNameAsync(username);
            if (userByName != null)
                return Results.BadRequest(Common.Response<string>.Failure("Username already exists"));
            if(profilePicture is null)
                return Results.BadRequest(Common.Response<string>.Failure("Profile picture is required"));
            var pictureName = await FileUpload.UploadFileAsync(profilePicture);
            pictureName = $"{httpContext.Request.Scheme}://{httpContext.Request.Host}/uploads/{pictureName}";

            var user = new AppUser  
            {
                Email = email,
                FullName = fullname,
                UserName = username,
                ProfileImage = pictureName
            };

            var result = await userManager.CreateAsync(user, password);
            if (!result.Succeeded)
                return Results.BadRequest(Common.Response<string>.Failure(result.Errors.Select(x=>x.Description).FirstOrDefault()!));

            return Results.Ok(Common.Response<string>.Success("","User created successfully"));
        }).DisableAntiforgery();
        

        group.MapPost("/login", async (UserManager<AppUser> userManager, TokenService tokenService, Login dto) =>
        {
            if (dto is null)
                return Results.BadRequest(Response<string>.Failure("Invalid login details"));
            
            var user = await userManager.FindByEmailAsync(dto.Email);
            if (user is null)
                return Results.BadRequest(Response<string>.Failure("Email not found"));

            var result = await userManager.CheckPasswordAsync(user, dto.Password);
            if (!result)
                return Results.BadRequest(Response<string>.Failure("Password not correct"));
            
            var token = tokenService.GenerationToken(user.Id, user.UserName!);
            return Results.Ok(Response<object>.Success(new { token, user }, "Login Successfully"));
        });

        group.MapGet("/me", async (HttpContext httpContext, UserManager<AppUser> userManager) =>
        {
            var userId = httpContext.User.GetUserIdString();
            var userName = httpContext.User.GetUserName();

            AppUser? currentLoggedInUser = null;
            if (!string.IsNullOrEmpty(userId))
            {
                currentLoggedInUser = await userManager.FindByIdAsync(userId);
            }
            if (currentLoggedInUser == null && !string.IsNullOrEmpty(userName))
            {
                currentLoggedInUser = await userManager.FindByNameAsync(userName);
            }

            if (currentLoggedInUser == null)
            {
                return Results.NotFound(Response<AppUser>.Failure("User not found"));
            }

            return Results.Ok(Response<AppUser>.Success(currentLoggedInUser, "Current Logged In User"));

        }).RequireAuthorization();

        group.MapGet("/users", async (HttpContext httpContext, UserManager<AppUser> userManager, AppDbcontext context) =>
        {
            var userId = httpContext.User.GetUserIdString();
            var userName = httpContext.User.GetUserName();
            var onlineUsersSet = new HashSet<string>(ChatHub.onlineUsers.Keys);

            var users = await userManager.Users
                .Where(x => (string.IsNullOrEmpty(userId) || x.Id != userId) && 
                            (string.IsNullOrEmpty(userName) || x.UserName != userName))
                .Select(x => new OnlineUserDto
                {
                    Id = x.Id,
                    UserName = x.UserName,
                    Email = x.Email,
                    FullName = x.FullName,
                    ProfilePicture = x.ProfileImage,
                    IsOnline = onlineUsersSet.Contains(x.UserName!),
                    UnreadCount = context.Messages.Count(m => m.ReceiverId == userId && m.SenderId == x.Id && !m.IsRead)
                })
                .OrderByDescending(u => u.IsOnline)
                .ToListAsync();

            return Results.Ok(Response<IEnumerable<OnlineUserDto>>.Success(users, "Users retrieved successfully"));
        }).RequireAuthorization();

        return group;
    }
}