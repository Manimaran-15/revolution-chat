const API = import.meta.env.VITE_API_URL || '';
let token = localStorage.getItem('revolution_token');
export const authToken = () => token;
export const setAuthToken = (next: string | null) => { token = next; if (next) localStorage.setItem('revolution_token', next); else localStorage.removeItem('revolution_token'); };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

// Upload with a progress callback (fetch cannot report upload progress). Works for large files/videos.
export function uploadFile(file: File, onProgress?: (percent: number) => void): Promise<{ url: string; name: string; type: string; size: number }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/uploads`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data: any = {}; try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}
