from pydantic import BaseModel

class SubscriptionRequest(BaseModel):
    topic: str
    message_type: str
