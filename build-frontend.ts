const { exec } = require("child_process");
const fs = require("fs-extra");
const path = require("path");

const frontendDir = path.join(__dirname, "frontend");
const buildDir = path.join(frontendDir, "build");
const publicDir = path.join(__dirname, "public");

console.log("Building frontend...");

exec("npm run build", { cwd: frontendDir }, (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error}`);
    return;
  }
  console.log(`Frontend build complete: ${stdout}`);

  console.log("Copying build files to public directory...");
  fs.removeSync(publicDir);
  fs.copySync(buildDir, publicDir);
  console.log("Copy complete.");
});
