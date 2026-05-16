//      Component for handling the entire layout
//      Utilizes the react-grid-layout v2
// 
import React from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';

import VideoWidget from '../widgets/VideoWidget';
import JoystickWidget from '../widgets/JoystickWidget';
// Future imports

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Dashboard = () => {
  const { width, containerRef, mounted } = useContainerWidth();

  // explicit layout definition for the v2
  const layout = [
    { i: 'cam_main', x: 0, y: 0, w: 8, h: 10 },
    { i: 'joystick', x: 8, y: 0, w: 4, h: 5 },
    // { i: 'telemetry', x: 8, y: 5, w: 4, h: 5 },
    // { i: 'actions', x: 0, y: 10, w: 4, h: 3 },
  ];

  return (
    <div 
      className="dashboard-container" 
      ref={containerRef} 
      style={{ background: '#111', minHeight: '100vh', padding: '16px' }}
    >
      {/* Only render the grid once the hook knows the container's physical width */}
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
          <div key="cam_main" style={widgetStyle}>
            <div className="widget-header" style={headerStyle}>
              Main Camera
            </div>
            <div style={contentStyle}>
              <VideoWidget streamName="jetson_stream" />
            </div>
          </div>

          {/* Joystick Module */}
          <div key="joystick" style={widgetStyle}>
            <div className="widget-header" style={headerStyle}>
               Control
            </div>
            <div style={contentStyle}>
              <JoystickWidget />
            </div>
          </div>
        </ReactGridLayout>
      )}
    </div>
  );
};

// Standardized UI formatting for the grid modules
const widgetStyle = {
  background: '#222',
  borderRadius: '8px',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle = {
  background: '#333',
  color: 'white',
  padding: '8px',
  cursor: 'grab',
  userSelect: 'none',
  fontWeight: 'bold',
};

const contentStyle = {
  flex: 1,
  position: 'relative',
};

export default Dashboard;