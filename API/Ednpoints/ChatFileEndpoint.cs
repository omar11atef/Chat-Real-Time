using System.Net.Http.Headers;
using API.Common;
using API.Data;
using API.DTOS;
using API.Entities;
using API.Extenions;
using API.Hubs;
using API.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace API.Endpoints;

public static class ChatFileEndpoint
{
    public static RouteGroupBuilder MapChatFileEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/chat-files")
            .WithTags("chat-files")
            .RequireAuthorization();

        group.MapPost("/upload", async (
            HttpContext httpContext,
            UserManager<AppUser> userManager,
            AppDbcontext dbContext,
            ChatFileService chatFileService,
            IHubContext<ChatHub> chatHubContext,
            [FromForm] string receiverId,
            [FromForm] IFormFile? file,
            [FromForm] string? caption,
            CancellationToken cancellationToken) =>
        {
            var sender = await ResolveCurrentUserAsync(httpContext, userManager);
            if (sender is null)
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrWhiteSpace(receiverId))
            {
                return Results.BadRequest(Response<MessageResponseDTO>.Failure("ReceiverId is required."));
            }

            var receiver = await userManager.FindByIdAsync(receiverId.Trim());
            if (receiver is null)
            {
                return Results.NotFound(Response<MessageResponseDTO>.Failure("Recipient user not found."));
            }

            var validation = await ChatFileValidator.ValidateAsync(file, cancellationToken);
            if (!validation.IsValid || validation.File is null)
            {
                return Results.BadRequest(
                    Response<MessageResponseDTO>.Failure(validation.ErrorMessage ?? "Invalid file.")
                );
            }

            var validated = validation.File;
            var (chatFolder, storedFileName, relativePath) = await chatFileService.SaveEncryptedFileAsync(
                file!,
                sender.Id,
                receiver.Id,
                cancellationToken
            );

            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

            var attachment = new ChatAttachment
            {
                SenderId = sender.Id,
                ReceiverId = receiver.Id,
                ChatFolder = chatFolder,
                OriginalFileName = validated.SafeFileName,
                StoredFileName = storedFileName,
                RelativePath = relativePath,
                DownloadUrl = string.Empty,
                ContentType = validated.ContentType,
                FileExtension = validated.Extension,
                FileCategory = validated.Category,
                FileSize = validated.FileSize,
                IsEncrypted = true,
                CreatedAt = DateTime.UtcNow
            };

            dbContext.ChatAttachments.Add(attachment);
            await dbContext.SaveChangesAsync(cancellationToken);

            var newMessage = new Meesage
            {
                SenderId = sender.Id,
                ReceiverId = receiver.Id,
                Content = caption?.Trim() ?? string.Empty,
                CreatedData = DateTime.UtcNow,
                IsRead = false,
                AttachmentId = attachment.Id,
                Attachment = attachment
            };

            dbContext.Messages.Add(newMessage);
            await dbContext.SaveChangesAsync(cancellationToken);

            attachment.MessageId = newMessage.Id;
            attachment.DownloadUrl = $"{httpContext.Request.Scheme}://{httpContext.Request.Host}/api/chat-files/{attachment.Id}";
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var responseDto = new MessageResponseDTO
            {
                Id = newMessage.Id,
                SenderId = newMessage.SenderId,
                ReceiverId = newMessage.ReceiverId,
                Content = newMessage.Content,
                CreatedData = newMessage.CreatedData,
                IsRead = newMessage.IsRead,
                AttachmentId = attachment.Id,
                Attachment = attachment
            };

            if (!string.IsNullOrEmpty(sender.UserName) &&
                ChatHub.onlineUsers.TryGetValue(sender.UserName, out var onlineSender) &&
                !string.IsNullOrEmpty(onlineSender.ConnectionId))
            {
                await chatHubContext.Clients.Client(onlineSender.ConnectionId)
                    .SendAsync("ReceiveMessage", responseDto, cancellationToken);
            }

            if (receiver.Id != sender.Id &&
                !string.IsNullOrEmpty(receiver.UserName) &&
                ChatHub.onlineUsers.TryGetValue(receiver.UserName, out var onlineRecipient) &&
                !string.IsNullOrEmpty(onlineRecipient.ConnectionId))
            {
                await chatHubContext.Clients.Client(onlineRecipient.ConnectionId)
                    .SendAsync("ReceiveMessage", responseDto, cancellationToken);
            }

            return Results.Ok(Response<MessageResponseDTO>.Success(responseDto, "File sent successfully."));
        })
        .DisableAntiforgery();

        group.MapGet("/{id:int}", async (
            int id,
            HttpContext httpContext,
            UserManager<AppUser> userManager,
            AppDbcontext dbContext,
            ChatFileService chatFileService,
            [FromQuery] bool download = false,
            CancellationToken cancellationToken = default) =>
        {
            var currentUser = await ResolveCurrentUserAsync(httpContext, userManager);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            var attachment = await dbContext.ChatAttachments.FindAsync([id], cancellationToken);
            if (attachment is null)
            {
                return Results.NotFound(Response<string>.Failure("Attachment not found."));
            }

            if (!string.Equals(attachment.SenderId, currentUser.Id, StringComparison.Ordinal) &&
                !string.Equals(attachment.ReceiverId, currentUser.Id, StringComparison.Ordinal))
            {
                return Results.Forbid();
            }

            httpContext.Response.Headers.XContentTypeOptions = "nosniff";
            httpContext.Response.Headers.CacheControl = "private, max-age=300";

            if (!download)
            {
                var disposition = new ContentDispositionHeaderValue("inline")
                {
                    FileName = ToSafeAsciiFileName(attachment.OriginalFileName),
                    FileNameStar = attachment.OriginalFileName
                };
                httpContext.Response.Headers.ContentDisposition = disposition.ToString();
            }

            return Results.Stream(
                async outputStream =>
                {
                    await chatFileService.DecryptToStreamAsync(attachment, outputStream, cancellationToken);
                },
                contentType: attachment.ContentType,
                fileDownloadName: download ? attachment.OriginalFileName : null
            );
        });

        return group;
    }

    private static async Task<AppUser?> ResolveCurrentUserAsync(
        HttpContext httpContext,
        UserManager<AppUser> userManager)
    {
        var userId = httpContext.User.GetUserIdString();
        if (!string.IsNullOrEmpty(userId))
        {
            var byId = await userManager.FindByIdAsync(userId);
            if (byId is not null) return byId;
        }

        var userName = httpContext.User.GetUserName();
        return !string.IsNullOrEmpty(userName)
            ? await userManager.FindByNameAsync(userName)
            : null;
    }

    private static string ToSafeAsciiFileName(string fileName)
    {
        var clean = new string(fileName.Select(ch => ch >= 32 && ch < 127 && ch != '"' ? ch : '_').ToArray());
        return string.IsNullOrWhiteSpace(clean) ? "attachment" : clean;
    }
}
