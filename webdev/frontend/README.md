# Robot Web Dashboard

A React-based web interface for remotely monitoring and controlling a ROS 2 robot. This dashboard connects to the robot via a WireGuard VPN, consuming low-latency WebRTC video streams and interfacing with ROS topics via `rosbridge_server`.

## Features
* **Dual WebRTC Video Streams:** Real-time, low-latency video monitoring (Main Camera & Thermal Vision) powered by MediaMTX and WHEP.
* **Keyboard Teleoperation (WASD):** Global keyboard event listeners that publish `geometry_msgs/Twist` commands directly to `/cmd_vel_server` with real-time visual UI feedback.
* **Virtual Joystick:** Touch/mouse compatible joystick for analog velocity control.
* **Telemetry Dashboard:** Reactive UI components for monitoring robot state (IMU, Battery levels).
* **Customizable Layout:** Draggable and resizable widgets utilizing `react-grid-layout`.

## Architecture & Tech Stack
* **Frontend Framework:** React (Vite)
* **ROS 2 Integration:** `roslibjs` (connecting to `rosbridge_server` via WebSockets)
* **Video Streaming:** MediaMTX (SRT to WebRTC translation)
* **Networking:** WireGuard VPN Gateway & Nginx Reverse Proxy

## Installation

1. Clone the repository:
    git clone <repository-url>
    cd <project-directory>

2. Install dependencies:
    npm install

## Running the Dashboard

**Development Mode:**
Run the Vite development server with hot-module replacement.
    npm run dev

**Production Build:**
To build the app for production deployment:
    npm run build

This will generate a `dist/` folder containing the compiled static assets.

## Widget Ecosystem
The UI is modular. To add new capabilities:
1. Create a new widget in `src/widgets/` (e.g., `MyNewWidget.jsx`).
2. Wrap its content in the reusable `<Card>` UI component.
3. Hook into ROS data using `const { telemetry, sendCommand } = useRobot();`.
4. Add it to the grid layout inside `src/components/Dashboard.jsx`.