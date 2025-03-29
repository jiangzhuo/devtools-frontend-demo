document.addEventListener('DOMContentLoaded', () => {
    const fetchTargetsBtn = document.getElementById('fetchTargetsBtn');
    const remoteIpInput = document.getElementById('remoteIp');
    const targetsList = document.getElementById('targetsList');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const targetsInfoDiv = document.getElementById('targetsInfo');

    // Instance Management Elements
    const createInstanceBtn = document.getElementById('createInstanceBtn');
    const instanceListUl = document.getElementById('instanceList');
    const instanceLoadingDiv = document.getElementById('instanceLoading');
    const instanceErrorDiv = document.getElementById('instanceError');

    // Load saved IP from localStorage
    const savedIp = localStorage.getItem('remoteChromeIp');
    if (savedIp) {
        remoteIpInput.value = savedIp;
    }

    // --- Event Listeners ---
    fetchTargetsBtn.addEventListener('click', fetchTargets);
    // Allow pressing Enter in the input field to trigger fetch
    remoteIpInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            fetchTargets();
        }
    });

    createInstanceBtn.addEventListener('click', createInstance);

    // Fetch initial list of managed instances on page load
    fetchManagedInstances();

    // --- Functions ---

    /** Fetches targets from a specific IP and optional Port */
    async function fetchTargets(ip = null, port = null) {
        // If IP is not provided, get it from the input field
        let targetIp = ip || remoteIpInput.value.trim();
        const targetPort = port; // Use provided port or null (backend defaults to 9222)

        if (!targetIp) {
            showError('Please enter the remote Chrome IP address.');
            return;
        }

        // Save IP to localStorage if fetched via manual input
        if (!ip) { // Only save if using the manual input field
            localStorage.setItem('remoteChromeIp', targetIp);
        }

        showLoading(true);
        clearError();
        clearTargets();
        updateTargetsInfo(`Fetching targets from ${targetIp}${targetPort ? ':' + targetPort : ':9222 (default)'}...`);

        try {
            // Construct query params, including port if specified
            const queryParams = new URLSearchParams({ ip: targetIp });
            if (targetPort) {
                queryParams.append('port', targetPort);
            }

            const response = await fetch(`/targets?${queryParams.toString()}`);
            showLoading(false);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error', details: 'Could not parse error response.' }));
                throw new Error(`Failed to fetch targets: ${response.status} ${response.statusText}. ${errorData.details || errorData.error || ''}`);
            }

            const targets = await response.json();
            updateTargetsInfo(`Targets from ${targetIp}${targetPort ? ':' + targetPort : ':9222 (default)'}:`);
            displayTargets(targets, targetIp, targetPort || 9222); // Pass IP and resolved port

        } catch (err) {
            console.error('Fetch error:', err);
            showLoading(false);
            showError(err.message || 'An unexpected error occurred.');
            updateTargetsInfo(''); // Clear info on error
        }
    }

    /** Displays the fetched list of debuggable targets */
    function displayTargets(targets, remoteIp, remotePort) {
        clearTargets();

        if (!targets || targets.length === 0) {
            targetsList.innerHTML = '<li>No debuggable targets found. Make sure headless Chrome is running with --remote-debugging-port=9222 and accessible.</li>';
            // Clear info if no targets found
            updateTargetsInfo(`No debuggable targets found on ${remoteIp}:${remotePort}.`);
            return;
        }

        targets.forEach(target => {
            // Only interested in 'page' type targets
            if (target.type === 'page') {
                const listItem = document.createElement('li');

                // Generate the DevTools frontend URL
                // Instead of using devtools:// protocol, we'll use our locally hosted DevTools frontend
                // Format: /devtools/inspector.html?ws=<HOST>:<PORT>/devtools/page/<ID>
                const wsUrl = target.webSocketDebuggerUrl;
                // Extract host:port from wsUrl or fallback to user input IP
                let hostPort = `${remoteIp}:${remotePort}`;
                try {
                    const urlParts = new URL(wsUrl);
                    hostPort = urlParts.host;
                } catch (e) {
                    console.warn("Could not parse wsUrl to extract host, falling back to input IP", e);
                }

                // Construct the path to our locally hosted DevTools frontend
                let wsPath = '';
                if (target.webSocketDebuggerUrl && target.webSocketDebuggerUrl.startsWith('ws://')) {
                    // Extract the path from the WebSocket URL if available
                    wsPath = target.webSocketDebuggerUrl.substring(target.webSocketDebuggerUrl.indexOf('/', 5));
                } else {
                    // Fallback to constructing the path
                    wsPath = `/devtools/page/${target.id}`;
                }

                // Use our locally hosted DevTools frontend
                const devtoolsUrl = `/devtools/inspector.html?ws=${hostPort}${wsPath}`;

                // For debugging/comparison, log both URLs
                console.log(`Using hosted DevTools URL: ${devtoolsUrl}`);
                console.log(`Original devtoolsFrontendUrl: ${target.devtoolsFrontendUrl}`);

                const title = target.title || 'Untitled Page';
                const url = target.url || 'No URL';

                listItem.innerHTML = `
                    <div class="target-info">
                        <span class="target-title">${escapeHtml(title)}</span>
                        <span class="target-url">${escapeHtml(url)}</span>
                    </div>
                    <div class="target-actions">
                        <a href="${encodeURI(devtoolsUrl)}" target="_blank" title="Open DevTools in new tab">Open DevTools (Hosted)</a>
                        <a href="${encodeURI(`devtools://devtools/bundled/inspector.html?ws=${hostPort}${wsPath}`)}" target="_blank" title="Open with browser's built-in DevTools">Open DevTools (Browser)</a>
                    </div>
                `;
                targetsList.appendChild(listItem);
            }
        });
        if (targetsList.children.length === 0) {
            targetsList.innerHTML = '<li>Only non-page targets found (e.g., service workers). Cannot open DevTools for these.</li>';
        }
    }

    /** Fetches and displays the list of managed Chrome instances */
    async function fetchManagedInstances() {
        try {
            showInstanceLoading(true);
            clearInstanceError();

            const response = await fetch('/instances');
            showInstanceLoading(false);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to list instances' }));
                throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
            }

            const instances = await response.json();
            displayInstances(instances);

        } catch (error) {
            console.error('Error fetching instances:', error);
            showInstanceLoading(false);
            showInstanceError(`Failed to fetch instances: ${error.message}`);
            displayInstances([]); // Clear list on error
        }
    }

    /** Displays the list of managed instances */
    function displayInstances(instances) {
        instanceListUl.innerHTML = ''; // Clear previous list
        if (!instances || instances.length === 0) {
            instanceListUl.innerHTML = '<li>No managed instances running.</li>';
            return;
        }

        instances.forEach(instance => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <div class="instance-info">
                    <span>PID: ${instance.pid}</span>
                    <span>Port: ${instance.port}</span>
                </div>
                <div class="instance-actions">
                    <button class="fetch-targets" data-pid="${instance.pid}" data-port="${instance.port}">Show Targets</button>
                    <button class="terminate" data-pid="${instance.pid}">Terminate</button>
                </div>
            `;

            // Add event listeners for buttons within this instance item
            listItem.querySelector('.fetch-targets').addEventListener('click', (e) => {
                const button = e.target;
                const port = button.getAttribute('data-port');
                // Managed instances are local, so use 127.0.0.1 (or localhost)
                fetchTargets('127.0.0.1', port);
            });

            listItem.querySelector('.terminate').addEventListener('click', (e) => {
                const button = e.target;
                const pid = button.getAttribute('data-pid');
                if (confirm(`Are you sure you want to terminate instance PID ${pid}?`)) {
                    terminateInstance(pid);
                }
            });

            instanceListUl.appendChild(listItem);
        });
    }

    /** Sends request to create a new Chrome instance */
    async function createInstance() {
        showInstanceLoading(true);
        clearInstanceError();
        try {
            const response = await fetch('/instances', { method: 'POST' });
            showInstanceLoading(false);

            const result = await response.json();

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${result.error || response.statusText}`);
            }

            console.log('Instance created:', result);
            fetchManagedInstances(); // Refresh the list

        } catch (error) {
            console.error('Error creating instance:', error);
            showInstanceLoading(false);
            showInstanceError(`Failed to create instance: ${error.message}`);
        }
    }

    /** Sends request to terminate a Chrome instance */
    async function terminateInstance(pid) {
        showInstanceLoading(true); // Show loading while terminating
        clearInstanceError();
        try {
            const response = await fetch(`/instances/${pid}`, { method: 'DELETE' });
            showInstanceLoading(false);

            const result = await response.json();

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${result.error || response.statusText}`);
            }

            console.log('Instance terminated:', result);
            fetchManagedInstances(); // Refresh the list

        } catch (error) {
            console.error(`Error terminating instance ${pid}:`, error);
            showInstanceLoading(false);
            showInstanceError(`Failed to terminate instance ${pid}: ${error.message}`);
            // Still refresh list in case the instance died but error occurred
            fetchManagedInstances();
        }
    }

    function showLoading(isLoading) {
        loadingDiv.style.display = isLoading ? 'block' : 'none';
    }

    function showInstanceLoading(isLoading) {
        instanceLoadingDiv.style.display = isLoading ? 'block' : 'none';
    }

    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function showInstanceError(message) {
        instanceErrorDiv.textContent = message;
        instanceErrorDiv.style.display = 'block';
    }

    function clearError() {
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
    }

    function clearInstanceError() {
        instanceErrorDiv.textContent = '';
        instanceErrorDiv.style.display = 'none';
    }

    function clearTargets() {
        targetsList.innerHTML = '';
    }

    /** Updates the informational text above the targets list */
    function updateTargetsInfo(text) {
        targetsInfoDiv.textContent = text;
    }

    // Basic HTML escaping
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
