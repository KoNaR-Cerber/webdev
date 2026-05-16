const VideoWidget = ({ streamName = 'jetson_stream' }) => {
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <iframe
        src={`/video/${streamName}`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Robot Camera"
        allow="autoplay; fullscreen"
      />
    </div>
  );
};

export default VideoWidget;