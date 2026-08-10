const https = require('https');
const http = require('http');
const { atomicWriteFile } = require('./fs-handlers');

function register(ipcMain, deps) {
  const { fs, path, IPC, ok, err, assertPath } = deps;

  ipcMain.handle(IPC.aiRequest, async (event, url, options) => {
    return new Promise((resolve) => {
      let urlObj;
      try {
        urlObj = new URL(url);
      } catch (e) {
        resolve(err(`Invalid URL: ${e.message}`));
        return;
      }
      const protocol = urlObj.protocol === 'https:' ? https : http;

      let hostname = urlObj.hostname;
      if (hostname === 'localhost') {
        hostname = '127.0.0.1';
      }

      const requestOptions = {
        hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 30000,
      };

      const req = protocol.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = {
              status: res.statusCode,
              headers: res.headers,
              data,
            };

            if (res.headers['content-type']?.includes('application/json')) {
              try {
                response.data = JSON.parse(data);
              } catch {
                // Keep as string if JSON parse fails
              }
            }

            resolve(response);
          } catch (error) {
            resolve(err(error.message || String(error)));
          }
        });
      });

      req.on('error', (error) => {
        resolve(err(error.message || String(error)));
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(err('Request timeout'));
      });

      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }

      req.end();
    });
  });

  ipcMain.handle(IPC.downloadImage, async (event, url, destinationPath, options = {}) => {
    const download = (currentUrl, redirectsLeft) =>
      new Promise((resolve, reject) => {
        const urlObj = new URL(currentUrl);
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
          reject(new Error('Only HTTP(S) image downloads are supported'));
          return;
        }
        const protocol = urlObj.protocol === 'https:' ? https : http;
        const request = protocol.get(
          currentUrl,
          {
            headers: options.headers || {},
            timeout: options.timeout || 120000,
          },
          (response) => {
            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location &&
              redirectsLeft > 0
            ) {
              response.resume();
              resolve(
                download(new URL(response.headers.location, currentUrl).toString(), redirectsLeft - 1)
              );
              return;
            }
            if (response.statusCode !== 200) {
              response.resume();
              reject(new Error(`Image download returned status ${response.statusCode}`));
              return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          }
        );
        request.on('timeout', () => request.destroy(new Error('Image download timed out')));
        request.on('error', reject);
      });

    try {
      const safeDestination = assertPath(destinationPath);
      const buffer = await download(url, 5);
      await atomicWriteFile(fs, path, safeDestination, buffer);
      return ok({ path: safeDestination });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.saveBase64Image, async (event, base64Data, destinationPath) => {
    try {
      const safeDestination = assertPath(destinationPath);
      const buffer = Buffer.from(base64Data || '', 'base64');
      if (!buffer.length) {
        return err('Empty image data');
      }
      await atomicWriteFile(fs, path, safeDestination, buffer);
      return ok({ path: safeDestination });
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
