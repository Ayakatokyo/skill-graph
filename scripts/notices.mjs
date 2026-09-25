import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const dirs=execFileSync('npm',['ls','--omit=dev','--all','--parseable'],{encoding:'utf8'}).trim().split('\n').slice(1);
const notices=['# Third-party notices','The bundled local viewer includes the packages below. Skill Graph application code was written for this project; no implementation was copied from the GitHub research candidates.'];
for(const dir of dirs){const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));const names=(await readdir(dir)).filter(n=>/^(license|licence|copying)(\..*)?$/i.test(n));notices.push(`\n## ${pkg.name} ${pkg.version}\nDeclared license: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}`);for(const name of names)notices.push(await readFile(path.join(dir,name),'utf8'));if(!names.length)throw new Error(`No license file found: ${pkg.name}`);}
await writeFile('skill-graph/THIRD_PARTY_NOTICES.md',notices.join('\n\n').trimEnd()+'\n');
console.log(`Wrote license notices for ${dirs.length} dependencies.`);
