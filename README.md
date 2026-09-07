# Wedding Album Upload

A no-build GitHub Pages frontend and Azure Functions API for uploading guest photos and videos to a personal OneDrive folder.

## Local preview

Open `index.html` in a browser for the interface preview. Camera access requires HTTPS or localhost. A local Azure Functions run uses `api/local.settings.json`, copied from `api/local.settings.json.example`. Until the Azure endpoint is configured, the page intentionally reports that the upload service is not connected.

## Azure and OneDrive setup

Follow [AZURE_SETUP.md](AZURE_SETUP.md) for the complete first-time setup. It includes the exact portal choices and a local helper for authorizing personal OneDrive without manually handling OAuth URLs.

The included GitHub Actions workflow publishes the repository root to Pages after pushes to `main`. In the repository settings, set Pages to use **GitHub Actions**. Update `ALLOWED_ORIGIN` with the exact Pages URL, including its repository path if it is a project site.

The API intentionally accepts anonymous requests because guests do not sign in. Keep the file-size limit and allowed-origin setting in place, and add rate limiting before a public event.