using System.Security.Cryptography;
using System.Text;
using API.Entities;

namespace API.Services;

public sealed class ChatFileService
{
    private const string ChatFilesRootFolder = "chat-files";
    private readonly string _webRootPath;
    private readonly byte[] _encryptionKey;

    public ChatFileService(IWebHostEnvironment environment, IConfiguration configuration)
    {
        _webRootPath = !string.IsNullOrWhiteSpace(environment.WebRootPath)
            ? environment.WebRootPath
            : Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");

        var rawSecret = configuration["FileEncryption:Key"]
            ?? configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Encryption key configuration is missing.");

        _encryptionKey = SHA256.HashData(Encoding.UTF8.GetBytes(rawSecret));
    }

    /// <summary>
    /// Computes a deterministic, path-safe folder name shared by both participants of a chat.
    /// </summary>
    public static string GetChatFolderName(string userAId, string userBId)
    {
        var a = SanitizeSegment(userAId);
        var b = SanitizeSegment(userBId);
        return string.CompareOrdinal(a, b) <= 0 ? $"{a}_{b}" : $"{b}_{a}";
    }

    /// <summary>
    /// Encrypts the uploaded file with AES-256-CBC and stores it inside wwwroot/chat-files/{chatFolder}/.
    /// </summary>
    public async Task<(string ChatFolder, string StoredFileName, string RelativePath)> SaveEncryptedFileAsync(
        IFormFile file,
        string senderId,
        string receiverId,
        CancellationToken cancellationToken = default)
    {
        var chatFolder = GetChatFolderName(senderId, receiverId);
        var baseDirectory = GetChatFilesRootFullPath();
        var targetDirectory = Path.GetFullPath(Path.Combine(baseDirectory, chatFolder));
        EnsurePathInsideBase(targetDirectory, baseDirectory);

        if (!Directory.Exists(targetDirectory))
        {
            Directory.CreateDirectory(targetDirectory);
        }

        var storedFileName = $"{Guid.NewGuid():N}.enc";
        var fullFilePath = Path.GetFullPath(Path.Combine(targetDirectory, storedFileName));
        EnsurePathInsideBase(fullFilePath, targetDirectory);

        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        aes.Key = _encryptionKey;
        aes.GenerateIV();

        await using (var outputFile = new FileStream(fullFilePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        {
            await outputFile.WriteAsync(aes.IV.AsMemory(0, aes.IV.Length), cancellationToken);
            await using var cryptoStream = new CryptoStream(outputFile, aes.CreateEncryptor(), CryptoStreamMode.Write, leaveOpen: true);
            await using var sourceStream = file.OpenReadStream();
            await sourceStream.CopyToAsync(cryptoStream, cancellationToken);
            await cryptoStream.FlushFinalBlockAsync(cancellationToken);
        }

        var relativePath = $"{ChatFilesRootFolder}/{chatFolder}/{storedFileName}";
        return (chatFolder, storedFileName, relativePath);
    }

    /// <summary>
    /// Decrypts a stored chat attachment file directly into the destination stream.
    /// </summary>
    public async Task DecryptToStreamAsync(
        ChatAttachment attachment,
        Stream destination,
        CancellationToken cancellationToken = default)
    {
        var baseDirectory = GetChatFilesRootFullPath();
        var normalizedRelative = attachment.RelativePath.Replace('/', Path.DirectorySeparatorChar);
        var fullFilePath = Path.GetFullPath(Path.Combine(_webRootPath, normalizedRelative));
        EnsurePathInsideBase(fullFilePath, baseDirectory);

        if (!File.Exists(fullFilePath))
        {
            throw new FileNotFoundException("Encrypted attachment file was not found.", fullFilePath);
        }

        await using var inputFile = new FileStream(fullFilePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        if (!attachment.IsEncrypted)
        {
            await inputFile.CopyToAsync(destination, cancellationToken);
            return;
        }

        var iv = new byte[16];
        var ivBytesRead = 0;
        while (ivBytesRead < iv.Length)
        {
            var read = await inputFile.ReadAsync(iv.AsMemory(ivBytesRead, iv.Length - ivBytesRead), cancellationToken);
            if (read == 0)
            {
                throw new InvalidDataException("Encrypted attachment file header is truncated.");
            }
            ivBytesRead += read;
        }

        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        aes.Key = _encryptionKey;
        aes.IV = iv;

        await using var cryptoStream = new CryptoStream(inputFile, aes.CreateDecryptor(), CryptoStreamMode.Read);
        await cryptoStream.CopyToAsync(destination, cancellationToken);
    }

    private string GetChatFilesRootFullPath()
    {
        var root = Path.GetFullPath(Path.Combine(_webRootPath, ChatFilesRootFolder));
        if (!Directory.Exists(root))
        {
            Directory.CreateDirectory(root);
        }
        return root;
    }

    private static string SanitizeSegment(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "unknown";
        }
        var chars = value.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_').ToArray();
        return chars.Length > 0 ? new string(chars) : "unknown";
    }

    private static void EnsurePathInsideBase(string candidatePath, string baseDirectory)
    {
        var normalizedBase = baseDirectory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidatePath.StartsWith(normalizedBase, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(candidatePath, baseDirectory, StringComparison.OrdinalIgnoreCase))
        {
            throw new UnauthorizedAccessException("Invalid attachment storage path.");
        }
    }
}
