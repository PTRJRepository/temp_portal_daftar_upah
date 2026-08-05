import axios from 'axios'

export const fetchReferenceHtml = async (filePath, token) => {
  const response = await axios.get('/payroll/reference_html', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    params: { file_path: filePath }
  })
  return response.data
}

