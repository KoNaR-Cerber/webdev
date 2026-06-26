from pydantic import ValidationError
from ..schemas import GPSDataSchema


def parse_gps_message(data: dict, app_state):
    """Parses and validates incoming MQTT data using Pydantic for live API states."""
    try:
        gps_model = GPSDataSchema(**data)
        if gps_model.latitude is not None and gps_model.longitude is not None:
            if app_state.latest_gps_data.date is None or app_state.latest_gps_data.date < gps_model.date:
                gps_model.is_valid = True

        app_state.latest_gps_data = gps_model
    except ValidationError as e:
        print(f"❌ GPS Payload failed validation: {e}")
    except Exception as e:
        print(f"Error processing live GPS message state: {e}")


MQTT_STATE_PARSERS = {
    "cerber/gps/data": parse_gps_message,
}


def handle_live_mqtt_state(topic: str, data: dict, app_state):
    """Dispatches MQTT data to specific state parsers."""
    parser = MQTT_STATE_PARSERS.get(topic)
    if parser:
        parser(data, app_state)
