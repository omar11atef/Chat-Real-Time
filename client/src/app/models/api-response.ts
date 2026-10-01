export interface ApiResponse<T> {
    IsSuccess: boolean;
    data: T;
    error:string;
    message: string;
}