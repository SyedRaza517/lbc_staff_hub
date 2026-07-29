// One-off helper: recreate an admin login after the database was reset by the
// Course/Unit rename push. Uses the Staff table (unchanged by the rename), so it
// works even with the current Prisma client.
//
//   Run it from the server folder:
//     cd server
//     node create-admin.js
//
// Then sign in with:  raza@lbc.ac.uk  /  123456789   (super admin, full access)
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { hashPassword } = require("./src/auth");
const prisma = new PrismaClient();

(async () => {
  try {
    let passwordHash = hashPassword("123456789");
    if (passwordHash && typeof passwordHash.then === "function") passwordHash = await passwordHash;
    const s = await prisma.staff.upsert({
      where: { email: "raza@lbc.ac.uk" },
      update: { passwordHash, accountRole: "ADMIN", isSuperAdmin: true, adminPages: null, pendingActivation: false, tokenVersion: 0 },
      create: {
        name: "Raza", jobTitle: "Lecturer", dept: "Teaching", email: "raza@lbc.ac.uk",
        passwordHash, accountRole: "ADMIN", isSuperAdmin: true, adminPages: null,
        initials: "R", colour: "#6d28d9", allowance: 28, pendingActivation: false,
      },
    });
    console.log("\n✅  Admin ready:", s.email, "(super admin)");
    console.log("    Password: 123456789\n");
  } catch (e) {
    console.error("\n❌  Failed:", e.message, "\n");
  } finally {
    await prisma.$disconnect();
  }
})();
