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



const Dashboard = () => {
  const { width, containerRef, mounted } = useContainerWidth();

  // layout definitions
  const layout = [
    { i: 'main_camera', x: 0, y: 0, w: 6, h: 10 },
    { i: 'thermal_camera', x: 8, y: 0, w: 6, h: 10 },
    { i: 'joystick', x: 0, y: 10, w: 2, h: 5 },
    // { i: 'telemetry', x: 8, y: 5, w: 4, h: 5 },
    { i: 'actions', x: 2, y: 10, w: 4, h: 5 },
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
                  streamPath="jetson_stream" 
              />
          </div>

          {/* Thermal Camera Module */}
          <div key="thermal_camera">
              <WebRTCCamera 
                  title="Thermal Camera" 
                  streamPath="thermal_stream" 
              />
          </div>

          {/* Joystick Module */}
          <div key="joystick">
            <Card title="Robot Control">
              <JoystickWidget />
            </Card>
          </div>
        
          {/* WASD Controls Module*/}
          <div key="actions">
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