export type Role =
  | "employee"
  | "department_manager"
  | "seat_manager"
  | "system_admin";
export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  employeeId?: string;
  role: Role;
  source: "local" | "oidc";
  lastLoginAt?: string;
}
export interface VersionInfo {
  version: string;
  commit: string;
  builtAt?: string;
}
export interface AuthConfig {
  serviceName: string;
  companyName: string;
  localEnabled: boolean;
  oidcEnabled: boolean;
  version: VersionInfo;
}
export interface Building {
  id: string;
  name: string;
  code: string;
  address: string;
}
export interface Floor {
  id: string;
  buildingId: string;
  buildingName: string;
  name: string;
  code: string;
  sortOrder: number;
}
export interface FloorMap {
  id: string;
  floorId: string;
  version: string;
  fileName: string;
  contentType: string;
  width?: number;
  height?: number;
  status: string;
  active: boolean;
  createdAt: string;
  floorName: string;
  buildingName: string;
  seatCount?: number;
  reviewCount?: number;
  contentUrl: string;
}
export interface Seat {
  id: string;
  floorMapId: string;
  seatNo: string;
  type: string;
  status: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  confidence?: number;
  organizationId?: string;
  organizationName?: string;
  employeeId?: string;
  employeeNo?: string;
  employeeName?: string;
}
export interface Employee {
  id: string;
  employeeNo: string;
  name: string;
  email?: string;
  organizationId?: string;
  organizationName?: string;
  title?: string;
  position?: string;
  workplace?: string;
  status: string;
  seatId?: string;
  seatNo?: string;
}
export interface Organization {
  id: string;
  externalId?: string;
  name: string;
  parentId?: string;
  color: string;
}
