const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '..', 'version.json');
const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));

const today = new Date();
const dateStr = `${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}`;

let revision = 1;
if (data.version.startsWith(dateStr + '.')) {
    revision = parseInt(data.version.split('.').pop(), 10) + 1;
}

const newVersion = `${dateStr}.${revision}`;
fs.writeFileSync(versionFile, JSON.stringify({ version: newVersion }, null, 2) + '\n');
console.log(`Version updated: ${data.version} -> ${newVersion}`);
