namespace API.Services;

public sealed record ValidatedChatFile(
    string SafeFileName,
    string Extension,
    string Category,
    string ContentType,
    long FileSize
);

public sealed record ChatFileValidationResult(
    bool IsValid,
    string? ErrorMessage,
    ValidatedChatFile? File
)
{
    public static ChatFileValidationResult Fail(string message) => new(false, message, null);
    public static ChatFileValidationResult Ok(ValidatedChatFile file) => new(true, null, file);
}

public static class ChatFileValidator
{
    public const long MaxFileSizeBytes = 25 * 1024 * 1024; // 25 MB

    private static readonly Dictionary<string, (string Category, string CanonicalContentType)> AllowedExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // Images (SVG intentionally excluded because it can embed scripts)
            [".jpg"] = ("image", "image/jpeg"),
            [".jpeg"] = ("image", "image/jpeg"),
            [".png"] = ("image", "image/png"),
            [".gif"] = ("image", "image/gif"),
            [".webp"] = ("image", "image/webp"),
            [".bmp"] = ("image", "image/bmp"),

            // PDF
            [".pdf"] = ("pdf", "application/pdf"),

            // Word
            [".doc"] = ("word", "application/msword"),
            [".docx"] = ("word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),

            // PowerPoint
            [".ppt"] = ("powerpoint", "application/vnd.ms-powerpoint"),
            [".pptx"] = ("powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),

            // Compressed archives
            [".zip"] = ("archive", "application/zip"),
            [".rar"] = ("archive", "application/vnd.rar"),
            [".7z"] = ("archive", "application/x-7z-compressed"),
            [".tar"] = ("archive", "application/x-tar"),
            [".gz"] = ("archive", "application/gzip"),

            // Text
            [".txt"] = ("text", "text/plain"),
            [".csv"] = ("text", "text/csv"),
            [".md"] = ("text", "text/markdown"),
        };

    private static readonly HashSet<string> BlockedDangerousExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
        ".html", ".htm", ".xhtml", ".svg", ".xml", ".xsl",
        ".exe", ".dll", ".msi", ".com", ".scr", ".pif", ".cpl", ".ocx", ".sys",
        ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".wsf", ".wsh", ".hta",
        ".sh", ".bash", ".zsh", ".ksh", ".csh",
        ".py", ".pyc", ".rb", ".pl", ".php", ".phtml", ".jsp", ".asp", ".aspx", ".cgi",
        ".jar", ".war", ".class", ".reg", ".inf", ".lnk", ".url",
        ".iso", ".img", ".dmg", ".apk", ".app",
        ".docm", ".xlsm", ".pptm", ".vb", ".vba", ".sct"
    };

    public static async Task<ChatFileValidationResult> ValidateAsync(
        IFormFile? file,
        CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length == 0)
        {
            return ChatFileValidationResult.Fail("Please select a non-empty file to send.");
        }

        if (file.Length > MaxFileSizeBytes)
        {
            return ChatFileValidationResult.Fail("File size exceeds the 25 MB limit.");
        }

        var rawName = Path.GetFileName(file.FileName)?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(rawName) || rawName.Contains('\0'))
        {
            return ChatFileValidationResult.Fail("Invalid file name.");
        }

        var extension = Path.GetExtension(rawName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            return ChatFileValidationResult.Fail("Files without an extension are not allowed.");
        }

        if (BlockedDangerousExtensions.Contains(extension))
        {
            return ChatFileValidationResult.Fail(
                $"File type '{extension}' is blocked for security reasons. Scripts, executables, and HTML/SVG files are not permitted."
            );
        }

        // Reject double-extension spoofing such as payload.js.png or evil.exe.pdf
        var nameParts = rawName.Split('.', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 1; i < nameParts.Length - 1; i++)
        {
            var innerExt = "." + nameParts[i];
            if (BlockedDangerousExtensions.Contains(innerExt))
            {
                return ChatFileValidationResult.Fail(
                    $"File name contains a blocked embedded extension ('{innerExt}') and cannot be uploaded."
                );
            }
        }

        if (!AllowedExtensions.TryGetValue(extension, out var spec))
        {
            return ChatFileValidationResult.Fail(
                $"File type '{extension}' is not supported. Allowed types: images, PDF, Word, PowerPoint, compressed archives, and text files."
            );
        }

        await using var stream = file.OpenReadStream();
        var headerLength = (int)Math.Min(4096, file.Length);
        var header = new byte[headerLength];
        var totalRead = 0;
        while (totalRead < headerLength)
        {
            var read = await stream.ReadAsync(header.AsMemory(totalRead, headerLength - totalRead), cancellationToken);
            if (read == 0) break;
            totalRead += read;
        }

        var sample = header.AsSpan(0, totalRead);
        if (!MatchesExpectedSignature(extension.ToLowerInvariant(), sample, file.Length))
        {
            return ChatFileValidationResult.Fail(
                $"The file content does not match the '{extension}' format or contains disallowed binary/script data."
            );
        }

        return ChatFileValidationResult.Ok(
            new ValidatedChatFile(
                rawName,
                extension.ToLowerInvariant(),
                spec.Category,
                spec.CanonicalContentType,
                file.Length
            )
        );
    }

    private static bool MatchesExpectedSignature(string ext, ReadOnlySpan<byte> header, long fileLength)
    {
        // Always reject PE/MZ, ELF, and Mach-O executables regardless of extension
        if (HasExecutableMagic(header))
        {
            return false;
        }

        return ext switch
        {
            ".png" => header.Length >= 8 &&
                      header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 &&
                      header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A,

            ".jpg" or ".jpeg" => header.Length >= 3 &&
                                 header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,

            ".gif" => header.Length >= 6 &&
                      header[0] == (byte)'G' && header[1] == (byte)'I' && header[2] == (byte)'F' &&
                      header[3] == (byte)'8' && (header[4] == (byte)'7' || header[4] == (byte)'9') &&
                      header[5] == (byte)'a',

            ".webp" => header.Length >= 12 &&
                       header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
                       header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P',

            ".bmp" => header.Length >= 2 && header[0] == (byte)'B' && header[1] == (byte)'M',

            ".pdf" => header.Length >= 5 &&
                      header[0] == (byte)'%' && header[1] == (byte)'P' && header[2] == (byte)'D' &&
                      header[3] == (byte)'F' && header[4] == (byte)'-',

            ".zip" or ".docx" or ".pptx" => HasZipSignature(header),

            ".doc" or ".ppt" => HasOle2Signature(header) || (ext == ".doc" && HasRtfSignature(header)),

            ".rar" => header.Length >= 6 &&
                      header[0] == 0x52 && header[1] == 0x61 && header[2] == 0x72 &&
                      header[3] == 0x21 && header[4] == 0x1A && header[5] == 0x07,

            ".7z" => header.Length >= 6 &&
                     header[0] == 0x37 && header[1] == 0x7A && header[2] == 0xBC &&
                     header[3] == 0xAF && header[4] == 0x27 && header[5] == 0x1C,

            ".gz" => header.Length >= 2 && header[0] == 0x1F && header[1] == 0x8B,

            ".tar" => HasTarSignature(header, fileLength),

            ".txt" or ".csv" or ".md" => IsSafePlainText(header),

            _ => false
        };
    }

    private static bool HasExecutableMagic(ReadOnlySpan<byte> header)
    {
        // MZ (PE/DOS), ELF, Mach-O
        if (header.Length >= 2 && header[0] == 0x4D && header[1] == 0x5A) return true;
        if (header.Length >= 4 && header[0] == 0x7F && header[1] == (byte)'E' && header[2] == (byte)'L' && header[3] == (byte)'F') return true;
        if (header.Length >= 4 &&
            ((header[0] == 0xFE && header[1] == 0xED && header[2] == 0xFA && (header[3] == 0xCE || header[3] == 0xCF)) ||
             ((header[0] == 0xCE || header[0] == 0xCF) && header[1] == 0xFA && header[2] == 0xED && header[3] == 0xFE)))
        {
            return true;
        }
        return false;
    }

    private static bool HasZipSignature(ReadOnlySpan<byte> header)
    {
        return header.Length >= 4 &&
               header[0] == 0x50 && header[1] == 0x4B &&
               ((header[2] == 0x03 && header[3] == 0x04) ||
                (header[2] == 0x05 && header[3] == 0x06) ||
                (header[2] == 0x07 && header[3] == 0x08));
    }

    private static bool HasOle2Signature(ReadOnlySpan<byte> header)
    {
        return header.Length >= 8 &&
               header[0] == 0xD0 && header[1] == 0xCF && header[2] == 0x11 && header[3] == 0xE0 &&
               header[4] == 0xA1 && header[5] == 0xB1 && header[6] == 0x1A && header[7] == 0xE1;
    }

    private static bool HasRtfSignature(ReadOnlySpan<byte> header)
    {
        return header.Length >= 5 &&
               header[0] == (byte)'{' && header[1] == (byte)'\\' && header[2] == (byte)'r' &&
               header[3] == (byte)'t' && header[4] == (byte)'f';
    }

    private static bool HasTarSignature(ReadOnlySpan<byte> header, long fileLength)
    {
        if (fileLength < 263 || header.Length < 263)
        {
            return false;
        }
        // POSIX ustar magic at byte offset 257
        return header[257] == (byte)'u' && header[258] == (byte)'s' && header[259] == (byte)'t' &&
               header[260] == (byte)'a' && header[261] == (byte)'r';
    }

    private static bool IsSafePlainText(ReadOnlySpan<byte> header)
    {
        var hasUtf16Bom = header.Length >= 2 &&
                          ((header[0] == 0xFF && header[1] == 0xFE) ||
                           (header[0] == 0xFE && header[1] == 0xFF));
        if (hasUtf16Bom)
        {
            return true;
        }

        foreach (var b in header)
        {
            if (b == 0x00)
            {
                return false;
            }
        }
        return true;
    }
}
