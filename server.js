const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage (persists while server runs)
let workorders = [
  {
      id: 1,
          title: 'Sample Work Order',
              status: 'Open',
                  priority: 'Medium',
                      asset: '',
                          location: '',
                              workType: 'Preventive',
                                  assignedTo: 'Bill',
                                      estimatedTime: '',
                                          description: 'This is a sample work order to get you started.',
                                              parts: [],
                                                  comments: [],
                                                      activity: [{ user: 'System', action: 'Work order created', time: new Date().toISOString() }],
                                                          createdAt: new Date().toISOString(),
                                                              updatedAt: new Date().toISOString()
                                                                }
                                                                ];
                                                                let nextId = 2;

                                                                // Get all work orders
                                                                app.get('/api/workorders', (req, res) => {
                                                                  res.json(workorders);
                                                                  });

                                                                  // Get single work order
                                                                  app.get('/api/workorders/:id', (req, res) => {
                                                                    const wo = workorders.find(w => w.id === parseInt(req.params.id));
                                                                      if (!wo) return res.status(404).json({ error: 'Not found' });
                                                                        res.json(wo);
                                                                        });

                                                                        // Create work order
                                                                        app.post('/api/workorders', (req, res) => {
                                                                          const wo = {
                                                                              id: nextId++,
                                                                                  ...req.body,
                                                                                      parts: req.body.parts || [],
                                                                                          comments: req.body.comments || [],
                                                                                              activity: [{ user: req.body.assignedTo || 'User', action: 'Work order created', time: new Date().toISOString() }],
                                                                                                  createdAt: new Date().toISOString(),
                                                                                                      updatedAt: new Date().toISOString()
                                                                                                        };
                                                                                                          workorders.push(wo);
                                                                                                            res.json(wo);
                                                                                                            });
                                                                                                            
                                                                                                            // Update work order
                                                                                                            app.put('/api/workorders/:id', (req, res) => {
                                                                                                              const idx = workorders.findIndex(w => w.id === parseInt(req.params.id));
                                                                                                                if (idx === -1) return res.status(404).json({ error: 'Not found' });
                                                                                                                  workorders[idx] = { ...workorders[idx], ...req.body, updatedAt: new Date().toISOString() };
                                                                                                                    res.json(workorders[idx]);
                                                                                                                    });
                                                                                                                    
                                                                                                                    // Delete work order
                                                                                                                    app.delete('/api/workorders/:id', (req, res) => {
                                                                                                                      workorders = workorders.filter(w => w.id !== parseInt(req.params.id));
                                                                                                                        res.json({ success: true });
                                                                                                                        });
                                                                                                                        
                                                                                                                        // Export all data
                                                                                                                        app.get('/api/export', (req, res) => {
                                                                                                                          res.json({ workorders, exportedAt: new Date().toISOString() });
                                                                                                                          });
                                                                                                                          
                                                                                                                          // Import data
                                                                                                                          app.post('/api/import', (req, res) => {
                                                                                                                            if (req.body.workorders) {
                                                                                                                                workorders = req.body.workorders;
                                                                                                                                    nextId = Math.max(...workorders.map(w => w.id), 0) + 1;
                                                                                                                                      }
                                                                                                                                        res.json({ success: true, count: workorders.length });
                                                                                                                                        });
                                                                                                                                        
                                                                                                                                        // Serve index.html for all other routes
                                                                                                                                        app.get('*', (req, res) => {
                                                                                                                                          res.sendFile(path.join(__dirname, 'public', 'index.html'));
                                                                                                                                          });
                                                                                                                                          
                                                                                                                                          app.listen(PORT, () => {
                                                                                                                                            console.log(`WorkOrder Pro running on port ${PORT}`);
                                                                                                                                            });
                                                                                                                                            
