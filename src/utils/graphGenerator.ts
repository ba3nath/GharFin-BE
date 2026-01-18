import { NetworthProjectionData } from "../models/NetworthProjection";
import * as fs from "fs";
import * as path from "path";

/**
 * Generate HTML file with Chart.js graph for networth projection
 */
export function generateNetworthGraphHTML(
  projectionData: NetworthProjectionData,
  outputPath: string
): void {
  const labels = projectionData.monthlyValues.map((d) => {
    const years = Math.floor(d.month / 12);
    const months = d.month % 12;
    if (years === 0) {
      return `Month ${months}`;
    }
    return `${years}Y ${months}M`;
  });

  const networthValues = projectionData.monthlyValues.map((d) => d.totalNetworth);
  const sipContributions = projectionData.monthlyValues.map((d) => d.sipContributions);

  // Find goal due dates for annotations with feasibility info
  const goalDueDates: Array<{ month: number; goalName: string; confidencePercent?: number; status?: string }> = [];
  for (const goal of projectionData.metadata.goals) {
    goalDueDates.push({
      month: goal.horizonMonths,
      goalName: goal.goalName,
      confidencePercent: goal.confidencePercent,
      status: goal.status,
    });
  }

  // Create scatter datasets for goal due dates with color coding
  // Green: 90%+ confidence (can_be_met)
  // Yellow: at_risk (less than 90% but not cannot_be_met)
  // Red: cannot_be_met
  const goalDueDateDatasets = goalDueDates
    .map(dueDate => {
      const dataIndex = dueDate.month;
      if (dataIndex < networthValues.length) {
        const value = networthValues[dataIndex];
        
        // Determine color based on confidence and status
        let pointColor = '#ef4444'; // Red (default - cannot_be_met)
        let borderColor = '#dc2626';
        
        if (dueDate.status === 'can_be_met' || (dueDate.confidencePercent !== undefined && dueDate.confidencePercent >= 90)) {
          pointColor = '#10b981'; // Green
          borderColor = '#059669';
        } else if (dueDate.status === 'at_risk' || (dueDate.confidencePercent !== undefined && dueDate.confidencePercent > 0 && dueDate.confidencePercent < 90)) {
          pointColor = '#f59e0b'; // Yellow/Orange
          borderColor = '#d97706';
        }
        
        return {
          type: 'scatter' as const,
          label: dueDate.goalName + ' Due',
          data: [{ x: dataIndex, y: value }],
          pointRadius: 8,
          pointBackgroundColor: pointColor,
          pointBorderColor: borderColor,
          pointBorderWidth: 2,
          showLine: false,
          xAxisID: 'x',
          yAxisID: 'y',
        };
      }
      return null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  
  // Stringify the datasets for embedding in the template
  const goalDueDateDatasetsJson = JSON.stringify(goalDueDateDatasets);

  // Find step-up months
  const stepUpMonths = projectionData.monthlyValues
    .filter((d) => d.events?.some((e) => e.startsWith("step_up")))
    .map((d) => d.month);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Networth Projection - ${projectionData.method.toUpperCase().replace('_BASIC', ' - Basic Tier').replace('_AMBITIOUS', ' - Ambitious Tier')}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .metadata {
            background-color: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .metadata h2 {
            margin-top: 0;
            font-size: 18px;
            color: #555;
        }
        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
        }
        .metadata-item {
            padding: 8px;
        }
        .metadata-label {
            font-weight: bold;
            color: #666;
            font-size: 12px;
        }
        .metadata-value {
            color: #333;
            font-size: 16px;
            margin-top: 4px;
        }
        .chart-container {
            position: relative;
            height: 500px;
            margin-top: 20px;
        }
        .legend {
            margin-top: 20px;
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: 4px;
        }
        .legend h3 {
            margin-top: 0;
            font-size: 16px;
            color: #555;
        }
        .legend-item {
            margin: 8px 0;
            display: flex;
            align-items: center;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            margin-right: 10px;
            border-radius: 3px;
        }
        .events-list {
            margin-top: 20px;
            padding: 15px;
            background-color: #fff3cd;
            border-radius: 4px;
            border-left: 4px solid #ffc107;
        }
        .events-list h3 {
            margin-top: 0;
            font-size: 16px;
            color: #856404;
        }
        .event-item {
            margin: 5px 0;
            color: #856404;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Total Networth Projection - ${projectionData.method.toUpperCase().replace('_BASIC', ' - Basic Tier').replace('_AMBITIOUS', ' - Ambitious Tier')}</h1>
        
        <div class="metadata">
            <h2>Planning Parameters</h2>
            <div class="metadata-grid">
                <div class="metadata-item">
                    <div class="metadata-label">Initial Total Corpus</div>
                    <div class="metadata-value">₹${projectionData.metadata.initialTotalCorpus.toLocaleString('en-IN')}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Total Monthly SIP</div>
                    <div class="metadata-value">₹${projectionData.metadata.totalMonthlySIP.toLocaleString('en-IN')}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Annual Step-Up</div>
                    <div class="metadata-value">${projectionData.metadata.stepUpPercent}%</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Projection Horizon</div>
                    <div class="metadata-value">${Math.floor(projectionData.maxMonth / 12)} years ${projectionData.maxMonth % 12} months</div>
                </div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="networthChart"></canvas>
        </div>

        <div class="legend">
            <h3>Graph Components</h3>
            <div class="legend-item">
                <div class="legend-color" style="background-color: #3b82f6;"></div>
                <span><strong>Total Networth:</strong> Combined corpus value across all goals, accounting for growth, SIP contributions, and goal completions</span>
            </div>
        </div>

        ${goalDueDates.length > 0 || stepUpMonths.length > 0 ? `
        <div class="events-list">
            <h3>Key Events</h3>
            ${goalDueDates.map(g => `
                <div class="event-item">
                    <strong>Month ${g.month}:</strong> ${g.goalName} due date - Basic tier corpus removed
                </div>
            `).join('')}
            ${stepUpMonths.map(m => `
                <div class="event-item">
                    <strong>Month ${m}:</strong> SIP step-up applied (${projectionData.metadata.stepUpPercent}% increase)
                </div>
            `).join('')}
        </div>
        ` : ''}
    </div>

    <script>
        const ctx = document.getElementById('networthChart').getContext('2d');
        
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'Total Networth',
                        data: ${JSON.stringify(networthValues.map((v, i) => ({ x: i, y: v })))},
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.1,
                        xAxisID: 'x',
                        yAxisID: 'y'
                    }${goalDueDateDatasets.length > 0 ? ',' + goalDueDateDatasetsJson.slice(1, -1) : ''}
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Month-by-Month Networth Projection',
                        font: {
                            size: 18
                        }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                label += '₹' + context.parsed.y.toLocaleString('en-IN');
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        id: 'x',
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Time (Months)'
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45,
                            stepSize: 12,
                            callback: function(value, index) {
                                // Map numeric value to label
                                const labelIndex = Math.round(value);
                                if (labelIndex >= 0 && labelIndex < ${JSON.stringify(labels)}.length) {
                                    return ${JSON.stringify(labels)}[labelIndex];
                                }
                                return value;
                            }
                        }
                    },
                    y: {
                        id: 'y',
                        title: {
                            display: true,
                            text: 'Amount (₹)'
                        },
                        ticks: {
                            callback: function(value) {
                                return '₹' + value.toLocaleString('en-IN');
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });

    </script>
</body>
</html>`;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write HTML file
  fs.writeFileSync(outputPath, html, "utf-8");
  console.log(`Graph generated: ${outputPath}`);
}
