using API.Entities;
using API.Common;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using API.Services;
using API.Extenions;
using Microsoft.EntityFrameworkCore;


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
        

        group.MapPost("/login",async (UserManager<AppUser> userManager,TokenService tokenService , 
        Login dto) =>
        {
            if(dto is null)
                return Results.BadRequest(Response<string>.Failure("Ivalide login Details")) ;
            
            var user = await userManager.FindByEmailAsync(dto.Email);
            if(user is null)
                return Results.BadRequest(Response<string>.Failure("Email not Found"));

            var result = await userManager.CheckPasswordAsync(user,dto.Password) ;
            if (!result)
                return Results.BadRequest(Response<string>.Failure("Password not correct"));
            
            var token = tokenService.GenerationToken(user.Id,user.UserName!);
            return Results.Ok(Response<string>.Success(token,"Login Successfully")) ;
        });

        _ = group.MapGet("/me", async (HttpContext httpContext, UserManager<AppUser> userManager) =>
        {
            var currentLoggedInUserId = httpContext.User.GetUserId()!;
            var currentLoggedInUser = await userManager.Users
                .SingleOrDefaultAsync(x => x.Id == currentLoggedInUserId.ToString());



        }).RequireAuthorization();
        return group;
    }
}