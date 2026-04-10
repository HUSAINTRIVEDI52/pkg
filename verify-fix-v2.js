const path = require('path');
const fs = require('fs-extra');
const { setupCIWorkflow } = require('./lib/ci');

async function test() {
  const testDir = path.resolve(__dirname, 'scratch/test_project_v2');
  const gitRoot = testDir;
  
  console.log('--- Testing setupCIWorkflow (v2: github-template) ---');
  await fs.ensureDir(testDir);
  
  try {
    // Run the setup
    await setupCIWorkflow(gitRoot);
    
    // Verify results
    const workflowPath = path.join(testDir, '.github', 'workflows', 'security-pipeline.yml');
    const scriptPath = path.join(testDir, '.github', 'scripts', 'run-all-scans.sh');
    
    if (await fs.pathExists(workflowPath)) {
      console.log('✅ Workflow (.github/workflows) created successfully.');
    } else {
      console.log('❌ Workflow missing.');
    }
    
    if (await fs.pathExists(scriptPath)) {
      console.log('✅ Scripts (.github/scripts) created successfully.');
    } else {
      console.log('❌ Scripts missing.');
    }
    
    const sourceVanishCheck = path.join(testDir, 'github-template');
    if (await fs.pathExists(sourceVanishCheck)) {
       console.log('❌ Error: github-template folder was copied literally instead of renamed to .github');
    } else {
       console.log('✅ github-template source correctly mapped to .github destination');
    }
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    // Cleanup
    // await fs.remove(testDir);
  }
}

test();
