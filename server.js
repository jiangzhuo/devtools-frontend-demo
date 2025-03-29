const express = require('express');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const findFreePort = require('find-free-port');

const app = express();
const port = 3000; // Port for this web interface

// In-memory store for managed Chrome instances { pid: { port: number, process: ChildProcess } }
const managedInstances = {};

// Serve main application static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve Chrome DevTools Frontend static files
try {
    // Use the pre-built Chrome DevTools frontend
    const devtoolsFrontendPath = path.join(__dirname, 'node_modules', 'chrome-devtools-frontend-build', 'build');
    console.log(`Serving DevTools frontend from: ${devtoolsFrontendPath}`);
    app.use('/devtools', express.static(devtoolsFrontendPath));
} catch (error) {
    console.error("Error setting up static path for chrome-devtools-frontend-build:", error);
    console.error("Ensure 'chrome-devtools-frontend-build' is installed correctly.");
}

// Endpoint to fetch targets from remote Chrome
app.get('/targets', (req, res) => {
    const ip = req.query.ip;
    const targetPort = req.query.port || 9222; // Added: Get port, default 9222
    if (!ip) {
        return res.status(400).json({ error: 'IP address is required' });
    }

    const url = `http://${ip}:${targetPort}/json`; // Updated URL
    console.log(`Fetching targets from: ${url}`);

    const request = http.get(url, (response) => {
        let data = '';

        // A chunk of data has been received.
        response.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received.
        response.on('end', () => {
            try {
                const targets = JSON.parse(data);
                console.log(`Successfully fetched ${targets.length} targets.`);
                res.json(targets);
            } catch (e) {
                console.error(`Error parsing JSON from ${url}:`, e);
                res.status(500).json({ error: 'Failed to parse JSON response from remote Chrome', details: e.message });
            }
        });
    });

    request.on('error', (error) => {
        console.error(`Error fetching targets from ${url}:`, error);
        // Provide more context in error
        res.status(500).json({ error: `Failed to connect to Chrome at ${ip}:${targetPort}`, details: error.message });
    });

     // Set a timeout for the request
    request.setTimeout(5000, () => { // 5 seconds timeout
        request.abort(); // Abort the request
        console.error(`Request timed out for ${url}`);
        // Ensure response is sent on timeout if not already sent by error handler
        if (!res.headersSent) {
             res.status(504).json({ error: `Request timed out connecting to ${ip}:${targetPort}` });
        }
    });
});

// --- Instance Management Endpoints ---

// GET /instances - List managed Chrome instances
app.get('/instances', (req, res) => {
    const instanceList = Object.entries(managedInstances).map(([pid, data]) => ({
        pid: parseInt(pid, 10),
        port: data.port,
    }));
    res.json(instanceList);
});

// POST /instances - Create a new Chrome instance
app.post('/instances', async (req, res) => {
    try {
        const [freePort] = await findFreePort(9300, 9500); // Search for free port in a range
        if (!freePort) {
            return res.status(500).json({ error: 'Could not find a free port for Chrome instance' });
        }

        const chromePath = 'google-chrome'; // Assumption: 'google-chrome' is in PATH
        const args = [
            '--headless',
            '--disable-gpu', // Often necessary for headless
            '--no-sandbox', // Sometimes needed depending on the environment, use with caution
            `--remote-debugging-port=${freePort}`,
            '--remote-debugging-address=0.0.0.0', // Allow connections from anywhere (including browser)
            `--user-data-dir=./chrome-data/instance-${freePort}`,
            // '--disable-dev-shm-usage',
            '--remote-allow-origins=devtools://devtools,http://localhost:3000',
            'https://example.com'
        ];

        console.log(`Attempting to start Chrome on port ${freePort} with command: ${chromePath} ${args.join(' ')}`);

        const chromeProcess = spawn(chromePath, args, {
            detached: true, // Allows parent to exit independently (optional)
            stdio: 'ignore', // Ignore stdout/stderr to prevent pipe saturation
        });

        chromeProcess.on('error', (err) => {
            console.error(`Failed to start Chrome process on port ${freePort}:`, err);
            // Send error response only if headers not already sent
            if (!res.headersSent) {
               res.status(500).json({ error: 'Failed to spawn Chrome process. Is google-chrome installed and in PATH?', details: err.message });
            }
             // Clean up if the process object exists but failed to start properly
            if (chromeProcess.pid && managedInstances[chromeProcess.pid]) {
                 delete managedInstances[chromeProcess.pid];
            }
        });

        chromeProcess.on('exit', (code, signal) => {
            console.log(`Chrome instance (PID: ${chromeProcess.pid}, Port: ${freePort}) exited with code ${code}, signal ${signal}`);
            // Remove from managed list when it exits
            if (chromeProcess.pid && managedInstances[chromeProcess.pid]) {
                delete managedInstances[chromeProcess.pid];
            }
        });

        // Wait a very short moment to see if an immediate error occurs
        await new Promise(resolve => setTimeout(resolve, 100));

        if (chromeProcess.pid) {
             // Check if an error response was already sent
             if (res.headersSent) {
                 console.log(`Response already sent for failed spawn on port ${freePort}, PID ${chromeProcess.pid}.`);
                 // Optional: try to kill the zombie process if it exists but failed?
                 try { process.kill(chromeProcess.pid, 'SIGKILL'); } catch (e) {}
                 return;
             }

            console.log(`Chrome instance started successfully. PID: ${chromeProcess.pid}, Port: ${freePort}`);
            managedInstances[chromeProcess.pid] = { port: freePort, process: chromeProcess };
            res.status(201).json({ pid: chromeProcess.pid, port: freePort });
        } else if (!res.headersSent) {
            // If PID is null/undefined and no error response sent, implies spawn failed silently early
             console.error(`Chrome process failed to spawn on port ${freePort}, PID is null.`);
             res.status(500).json({ error: 'Failed to spawn Chrome process, PID not assigned.' });
        }

    } catch (error) {
         console.error('Error finding free port or spawning Chrome:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error while creating Chrome instance', details: error.message });
          }
    }
});


// DELETE /instances/:pid - Terminate a Chrome instance
app.delete('/instances/:pid', (req, res) => {
    const pid = parseInt(req.params.pid, 10);
    if (isNaN(pid)) {
        return res.status(400).json({ error: 'Invalid PID' });
    }

    const instance = managedInstances[pid];
    if (!instance) {
        return res.status(404).json({ error: 'Instance not found or not managed by this server' });
    }

    console.log(`Attempting to terminate Chrome instance (PID: ${pid}, Port: ${instance.port})`);
    try {
        // Send SIGTERM first for graceful shutdown
        process.kill(pid, 'SIGTERM');
        // Optional: Add a timeout and then send SIGKILL if it doesn't terminate
        // setTimeout(() => {
        //     try {
        //         process.kill(pid, 'SIGKILL'); // Force kill if still running
        //         console.log(`Sent SIGKILL to Chrome instance (PID: ${pid})`);
        //     } catch (killError) {
        //         // Ignore errors if process already exited
        //         if (killError.code !== 'ESRCH') {
        //              console.error(`Error sending SIGKILL to PID ${pid}:`, killError);
        //         }
        //     }
        // }, 2000); // 2 second timeout

        // Remove immediately from management list (process exit handler will also try)
        delete managedInstances[pid];
        res.status(200).json({ message: `Termination signal sent to instance PID ${pid}` });

    } catch (error) {
        // ESRCH means Process doesn't exist (already terminated or invalid PID)
        if (error.code === 'ESRCH') {
            console.log(`Instance (PID: ${pid}) already terminated or invalid.`);
             delete managedInstances[pid]; // Ensure it's removed if error occurs
            res.status(404).json({ error: 'Instance already terminated or not found' });
        } else {
            console.error(`Error terminating Chrome instance PID ${pid}:`, error);
            res.status(500).json({ error: 'Failed to terminate instance', details: error.message });
        }
    }
});

// Graceful shutdown: attempt to kill managed Chrome processes on server exit
const cleanup = () => {
    console.log('Server shutting down. Terminating managed Chrome instances...');
    Object.keys(managedInstances).forEach(pidStr => {
        const pid = parseInt(pidStr, 10);
        const instance = managedInstances[pid];
        if (instance && instance.process) {
            console.log(`Terminating instance PID: ${pid}, Port: ${instance.port}`);
            try {
                process.kill(pid, 'SIGTERM');
            } catch (e) {
                 console.warn(`Failed to send SIGTERM to PID ${pid}: ${e.message}`);
                 // Maybe try SIGKILL as a last resort?
                 try { process.kill(pid, 'SIGKILL'); } catch (e2) {}
            }
        }
    });
     // Clear the object to prevent duplicate attempts if exit takes time
     Object.keys(managedInstances).forEach(pid => delete managedInstances[pid]);
    process.exit(0); // Exit cleanly
};

process.on('SIGINT', cleanup); // Ctrl+C
process.on('SIGTERM', cleanup); // Termination signal


app.listen(port, () => {
    console.log(`devtools-frontend-demo server listening at http://localhost:${port}`);
});
