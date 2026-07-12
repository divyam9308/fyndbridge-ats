import { PERMISSION_ITEMS } from '../features/attendance/attendanceData'

export const ATTENDANCE_PERMISSION_STORAGE_KEY = 'fb-attendance-permissions'
export const DEFAULT_ATTENDANCE_PERMISSIONS = Object.fromEntries(PERMISSION_ITEMS.map(([key]) => [key, 'admins']))

export function loadAttendancePermissions() {
  try {
    return { ...DEFAULT_ATTENDANCE_PERMISSIONS, ...(JSON.parse(localStorage.getItem(ATTENDANCE_PERMISSION_STORAGE_KEY)) || {}) }
  } catch {
    return { ...DEFAULT_ATTENDANCE_PERMISSIONS }
  }
}

export function saveAttendancePermissions(permissions) {
  localStorage.setItem(ATTENDANCE_PERMISSION_STORAGE_KEY, JSON.stringify({ ...DEFAULT_ATTENDANCE_PERMISSIONS, ...permissions }))
}
