const fs = require('fs');

try {
  const jsonPath = process.argv[2];
  const htmlPath = process.argv[3];
  
  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: File not found - ${jsonPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(rawData);
  
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pipeline Security Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
        .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        h1 { margin-top: 0; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; color: #1f2937; }
        .badge { display: inline-block; padding: 6px 12px; font-weight: 600; font-size: 14px; border-radius: 6px; margin-bottom: 20px; background: #e0e7ff; color: #3730a3; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; }
        th { background-color: #f9fafb; font-weight: 600; color: #4b5563; }
        .sev-badge { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .sev-Critical { background-color: #fee2e2; color: #991b1b; }
        .sev-High { background-color: #fef08a; color: #854d0e; }
        .sev-Medium { background-color: #ffedd5; color: #9a3412; }
        .sev-Low { background-color: #dcfce7; color: #166534; }
        .sev-Info { background-color: #e0f2fe; color: #075985; }
        .pre-wrap { background: #f9fafb; padding: 15px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Pipeline Security Report</h1>`;

  if (data.results && data.results.length > 0) {
    html += `
        <div class="badge">Total Findings: ${data.count || data.results.length}</div>
        <table>
            <thead>
                <tr>
                    <th>Severity</th>
                    <th>Vulnerability Title</th>
                    <th>Location / Component</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>`;
            
    data.results.forEach(finding => {
      const sev = finding.severity || 'Info';
      let location = finding.file_path ? finding.file_path + (finding.line ? ':' + finding.line : '') : finding.component_name;
      location = location || 'N/A';
      
      html += `
                <tr>
                    <td><span class="sev-badge sev-${sev}">${sev}</span></td>
                    <td>${finding.title || 'N/A'}</td>
                    <td>${location}</td>
                    <td>${finding.active ? 'Active' : 'Inactive'}</td>
                </tr>`;
    });
    
    html += `
            </tbody>
        </table>`;
  } else if (data.scan_summary) {
    html += `
        <div class="badge">Raw JSON Scan Summary</div>
        <p>DefectDojo returned no findings or was unreachable. Below is the raw fallback summary:</p>
        <div class="pre-wrap"><pre>${JSON.stringify(data.scan_summary, null, 2)}</pre></div>`;
  } else {
    html += `
        <div class="badge">No findings</div>
        <p>No valid DefectDojo findings or scan summary found in the report.</p>`;
  }

  html += `
    </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  console.log(`Successfully generated HTML report at: ${htmlPath}`);
} catch (error) {
  console.error(`Failed to generate HTML report: ${error.message}`);
  process.exit(1);
}
