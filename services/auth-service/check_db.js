const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { email: { contains: 'admin' } } });
  console.log("Admins found:", users.map(u => ({ email: u.email, roleId: u.roleId, name: u.name })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
