# Pre-flight checks

## Google Health API access (plan Task 0)

Status: **not yet run.** Keep `FITBIT_ENABLED=false` until this passes.

1. In Google Cloud Console, create a project, enable the **Google Health API**, and set the OAuth consent screen to **External / Testing**.
2. Add the team's personal Google accounts as test users.
3. Add the scopes:
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
4. In the OAuth Playground (using your own client), authorize both scopes, then call:
   `GET https://health.googleapis.com/v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints?pageSize=5`
   - Pass: HTTP 200 with `dataPoints`. Set `FITBIT_ENABLED=true`.
   - Fail: record the error below and leave Fitbit off. WHOOP ships alone.
5. Add the redirect URI `${PUBLIC_BASE_URL}/oauth/fitbit/callback`.

Result: _date, pass/fail, error_

## WHOOP app

1. In the WHOOP Developer Dashboard, create the app with the redirect `${PUBLIC_BASE_URL}/oauth/whoop/callback` and the scopes `read:recovery read:cycles offline`.
2. Store the client ID and secret in your secrets store, not in git.

## E2E (plan Task 17)

_Not yet run._
