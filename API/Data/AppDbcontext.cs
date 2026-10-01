using API.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace API.Data; 
public class AppDbcontext(DbContextOptions<AppDbcontext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Meesage> Messages {get;set;}
}


