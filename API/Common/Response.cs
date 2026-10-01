
namespace API.Common;

public class Response<T>(bool isSuccess, T data, string error, string message)
{
    public bool IsSuccess { get; set; } = isSuccess;
    public T Data { get; } = data;
    public string Error { get; } = error;
    public string Message { get; set; } = message;

    public static Response<T> Success(T data, string message = "") => new(true, data, string.Empty, message);

    public static Response<T> Failure(string error, string message = "") => new(false, default!, error, message);
}