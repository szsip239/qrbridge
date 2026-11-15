import { execFile } from 'node:child_process';

export function createBridgeCli({ bridge, serial, python = 'python3' }) {
  const prefix = [bridge, ...(serial ? ['--serial', serial] : [])];
  return args => new Promise((resolve, reject) => {
    execFile(python, [...prefix, ...args], { maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim().split('\n').at(-1)?.replace(/^\w+(Error|Exception): /, '') || error.message));
      else resolve(JSON.parse(stdout));
    });
  });
}
