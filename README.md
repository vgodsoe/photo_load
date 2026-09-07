# Wedding Album Upload

A no-build GitHub Pages frontend and Azure Functions API for uploading guest photos and videos to a personal OneDrive folder.

## Local preview

Open `index.html` in a browser for the interface preview. Camera access requires HTTPS or localhost. A local Azure Functions run uses `api/local.settings.json`, copied from `api/local.settings.json.example`. Until the Azure endpoint is configured, the page intentionally reports that the upload service is not connected.

## OneDrive setup

1. Register an app in the Microsoft Entra admin center with accounts in any organizational directory and personal Microsoft accounts. Create a client secret and keep it out of Git.
2. Add a web redirect URI for a one-time OAuth authorization helper using `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize`.
3. Request delegated `Files.ReadWrite` and `offline_access` permissions.
4. Complete the authorization-code flow once and store the returned refresh token as an Azure Function application setting.
5. Create an Azure Function App using Node 18+ and deploy the `api` directory. From that directory, run `npm install` before deploying with Azure Functions Core Tools.
6. Configure these application settings:

   - `MICROSOFT_CLIENT_ID`
   - `MICROSOFT_CLIENT_SECRET`
   - `MICROSOFT_REFRESH_TOKEN`
   - `ONEDRIVE_FOLDER_PATH` (for example, `Wedding Uploads`)
   - `ALLOWED_ORIGIN` (the GitHub Pages URL)

7. Put the deployed function URL in `UPLOAD_ENDPOINT` near the top of `app.js`.
8. Enable GitHub Pages for the repository root and print a QR code pointing at that Pages URL.

The included GitHub Actions workflow publishes the repository root to Pages after pushes to `main`. In the repository settings, set Pages to use **GitHub Actions**. Update `ALLOWED_ORIGIN` with the exact Pages URL, including its repository path if it is a project site.

The API intentionally accepts anonymous requests because guests do not sign in. Keep the file-size limit and allowed-origin setting in place, and add rate limiting before a public event.