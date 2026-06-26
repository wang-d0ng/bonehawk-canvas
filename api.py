import base64
import hashlib
import hmac
import time
import urllib.request

partner_id = "public"  # ID provided by AB.
partner_key = "2jfaWErgt2+o48gsk302kd"  # Key provided by AB.
expires = str(
    int(time.time() + 86400)
)  # Seconds since epoch. Example expires in 24 hours.
user_id = "Bob"  # Optional. Partner defined string. Provides access only for queries with this `user.id`.

message = expires + "\n" + user_id
digest = hmac.new(
    partner_key.encode(), message.encode(), digestmod=hashlib.sha256
).digest()
signature = base64.b64encode(digest).decode()
encoded_sig = urllib.parse.quote_plus(signature)

# user.id is optional
parms = (
    "partner.id="
    + partner_id
    + "&auth.signature="
    + encoded_sig
    + "&auth.expires="
    + expires
    + "&user.id="
    + user_id
)
result = urllib.request.urlopen(
    "https://api.abconnect.instructure.com/rest/v4.1/standards?" + parms
).read()
print(result)
