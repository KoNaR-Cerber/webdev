//      Component for handling the entire layout
//      Utilizes the react-grid-layout v2
// 
// for the app to render properly 
import React from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// imports for modules
import WebRTCCamera from '../ui/WebRTCCamera';
import JoystickWidget from '../widgets/JoystickWidget';
import WasdWidget from '../widgets/WasdWidget';
import Card from '../ui/Card';
import PanTiltWidget from '../widgets/PanTiltWidget';



const Dashboard = () => {
  const { width, containerRef, mounted } = useContainerWidth();

  // layout definitions
  const layout = [
    { i: 'main_camera', x: 0, y: 0, w: 6, h: 10 },
    { i: 'ir_camera', x: 8, y: 0, w: 6, h: 10 },
    { i: 'movement', x: 0, y: 10, w: 3, h: 5 },
    { i: 'camera_controls', x: 10, y: 10, w: 3, h: 5},
    { i: 'joystick', x: 5, y: 10, w: 2, h: 5 },
    // { i: 'telemetry', x: 8, y: 5, w: 4, h: 5 },
  
  ];

  return (
    <div 
      className="dashboard-container" 
      ref={containerRef} 
      style={{ background: '#111', minHeight: '100vh', padding: '16px' }}
    >
            {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: 12,
            rowHeight: 30,
            margin: [16, 16],
          }}
          dragConfig={{
            enable: true,
            handle: '.widget-header',
          }}
          resizeConfig={{
            enable: true,
          }}
        >
          {/* Main Camera Module */}
          <div key="main_camera">
              <WebRTCCamera 
                  title="Main Camera" 
                  streamPath="video/normal_cam" 
              />
          </div>

          {/* IR Camera Module */}
          <div key="ir_camera">
              <WebRTCCamera 
                  title="IR Camera" 
                  streamPath="video/IR_cam" 
              />
          </div>

          {/* Joystick Module */}
          <div key="joystick">
            <Card title="Robot Control">
              <JoystickWidget />
            </Card>
          </div>

          {/* Camera Controls Module */}
          <div key="camera_controls">
            <Card title="Camera Controls">
                <PanTiltWidget />
            </Card>
          </div>
        
          {/* WASD Controls Module*/}
          <div key="movement">
            <Card title="Keyboard Teleop">
                <WasdWidget />
            </Card>
          </div>

        </ReactGridLayout>
      )}
    </div>
  );
};



export default Dashboard;