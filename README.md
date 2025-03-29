# devtools-frontend-demo

A web interface to manage locally running headless Chrome instances and connect to their DevTools, or manually connect to a remote instance. Includes a locally hosted Chrome DevTools frontend.

## Features

*   **Instance Management:**
    *   Create new headless Chrome instances locally on demand.
    *   Automatically finds a free port for new instances (starting from 9300).
    *   Lists currently managed instances (PID, Port).
    *   Terminate managed instances.
*   **Target Discovery:**
    *   Fetch debuggable targets (`/json` endpoint) from managed local instances.
    *   Manually fetch targets from any Chrome instance by providing its IP address (assumes port 9222).
*   **DevTools Connection:**
    *   Generates `devtools://` links to open the Chrome DevTools connected to each target page.
    *   **Locally Hosted DevTools Frontend:**
        *   Includes a locally hosted version of the Chrome DevTools frontend (via `chrome-devtools-frontend` npm package).
        *   Provides options to use either the hosted frontend or the browser's built-in DevTools.
*   **Persistence:**
    *   Remembers the last used IP address for manual connections.

## How it Works

1.  **Backend (Node.js/Express):**
    *   Serves the static frontend files.
    *   Manages Chrome instances using Node.js `child_process`.
    *   Hosts a version of the Chrome DevTools frontend at the `/devtools` path.
    *   Provides API endpoints:
        *   `GET /instances`: List managed instances.
        *   `POST /instances`: Create a new instance.
        *   `DELETE /instances/:pid`: Terminate an instance.
        *   `GET /targets`: Proxies requests to the target Chrome instance's `/json` endpoint (accepts `ip` and `port` query parameters).
2.  **Frontend (HTML/Vanilla JS):**
    *   Provides UI to manage instances (create, list, terminate).
    *   Allows fetching targets from managed instances or a manually specified IP, with options to open them in either the hosted DevTools or the browser's built-in DevTools.
    *   Dynamically displays instances and targets with links to open their respective DevTools instances (`devtools://` URL).

## Prerequisites

*   Node.js and npm installed.
*   `google-chrome` (or compatible Chromium browser) installed and accessible in the system's PATH on the machine running the devtools-frontend-demo server.
*   For manual connections: A remote machine running headless Chrome with the remote debugging port enabled (e.g., `google-chrome --headless --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`). **Ensure your firewall allows connections to the specified port (default 9222) from the machine running devtools-frontend-demo.**

## Setup and Run

1.  **Clone the repository (or create the files as described):**
    ```bash
    git clone https://github.com/yourusername/devtools-frontend-demo.git
    cd devtools-frontend-demo
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    npm install chrome-devtools-frontend-build  # For the hosted DevTools frontend
    # Note: The package.json already includes these dependencies
    ```

3.  **Start the server:**
    *   Make sure no other process is using port 3000.
    ```bash
    npm start
    # You should see: "devtools-frontend-demo server listening at http://localhost:3000"
    ```

4.  **Access the interface:** Open your web browser and navigate to `http://localhost:3000`.

5.  **Manage Instances:** Use the "Managed Instances" section to create, view, or terminate local Chrome processes.

6.  **Fetch Targets:** Click "Show Targets" for a managed instance, or use the "Manual Connection" section to enter an IP and fetch targets from any Chrome instance.

7.  **Connect:** For each target, you'll have two options:
    * **Open DevTools (Hosted)** - Uses the locally hosted DevTools frontend from the npm package
    * **Open DevTools (Browser)** - Uses the browser's built-in DevTools (the original method)

## Hosted DevTools Frontend

This application includes a locally hosted version of the Chrome DevTools frontend via the `chrome-devtools-frontend` npm package. This allows you to:
* Use DevTools without relying on the `devtools://` protocol (which only works in Chrome/Chromium browsers)
* Potentially use the DevTools in browsers that don't support the `devtools://` protocol

### Chrome Launch Configuration

When creating new Chrome instances, the following parameters are used:

```
google-chrome --headless --disable-gpu --no-sandbox --remote-debugging-port=PORT 
--remote-debugging-address=0.0.0.0 --user-data-dir=./chrome-data/instance-PORT 
--remote-allow-origins=devtools://devtools,http://localhost:3000 https://example.com
```

Key parameters:
* `--remote-debugging-port`: The port Chrome listens on for DevTools connections
* `--remote-debugging-address=0.0.0.0`: Allows connections from any IP (not just localhost)
* `--remote-allow-origins`: Allows WebSocket connections from both the browser's built-in DevTools and our locally hosted version

## Notes

*   The application runs on port 3000 by default.
*   When connecting via DevTools (clicking a link), the connection is made directly from *your local browser* to the target Chrome instance using WebSockets. The devtools-frontend-demo server only facilitates discovery and instance management.
*   **Important:** The hosted DevTools frontend may have compatibility issues with some Chrome instances. If you encounter problems with the hosted version, use the "Open DevTools (Browser)" option as a fallback.
