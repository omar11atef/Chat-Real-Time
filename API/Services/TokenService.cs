using System;
using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace API.Services;

public class TokenService(IConfiguration configuration)
{
    private readonly IConfiguration _configuration = configuration ;

    public string GenerationToken(string userId,string userName)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.ASCII.GetBytes(_configuration["Jwt:Key"]!); 
        var claim = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier,userId),
            new(ClaimTypes.Name,userName)
        };

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new(claim),
            Expires = DateTime.UtcNow.AddDays(1),
            SigningCredentials= new(new SymmetricSecurityKey(key),SecurityAlgorithms.HmacSha256)
        };

        var token = tokenHandler.CreateToken(tokenDescriptor);
        return tokenHandler.WriteToken(token) ;
    }

}
