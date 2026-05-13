const { execSync } = require('child_process');
try {
  const start = Date.now();
  const output = execSync('gh repo list --limit 5', { encoding: 'utf8' });
  const end = Date.now();
  console.log(output);
  console.log(`Execution time: ${end - start}ms`);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
