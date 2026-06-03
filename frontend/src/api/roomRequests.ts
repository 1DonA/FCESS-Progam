/** Cross-department room booking requests. */
import { apiClient } from './client';

export interface RoomRequest {
    id: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
    requester_department_id: string;
    requester_department_code?: string | null;
    requester_department_name?: string | null;
    owner_department_id: string;
    owner_department_code?: string | null;
    owner_department_name?: string | null;
    room_id: string;
    room_number?: string | null;
    building_name?: string | null;
    course_id?: string | null;
    course_code?: string | null;
    section_id?: string | null;
    semester_id?: string | null;
    day_of_week: number;
    start_slot: string;
    duration_minutes: number;
    message?: string | null;
    response_message?: string | null;
    help_offered?: string | null;
    created_at: string;
    responded_at?: string | null;
}

export interface RoomRequestCreate {
    requester_department_id: string;
    room_id: string;
    day_of_week: number;
    start_slot: string;        // HH:MM
    duration_minutes: number;
    course_id?: string | null;
    section_id?: string | null;
    semester_id?: string | null;
    message?: string | null;
}

export interface RoomRequestRespond {
    action: 'accept' | 'reject';
    response_message?: string | null;
    help_offered?: string | null;
    auto_create_session?: boolean;
}

export const roomRequestsApi = {
    create: (b: RoomRequestCreate) =>
        apiClient.post<RoomRequest>('/room-requests', b).then((r) => r.data),

    incoming: (status?: string) =>
        apiClient.get<RoomRequest[]>(`/room-requests/incoming${status ? `?status=${status}` : ''}`).then((r) => r.data),

    outgoing: (status?: string) =>
        apiClient.get<RoomRequest[]>(`/room-requests/outgoing${status ? `?status=${status}` : ''}`).then((r) => r.data),

    respond: (id: string, body: RoomRequestRespond) =>
        apiClient.post<RoomRequest>(`/room-requests/${id}/respond`, body).then((r) => r.data),

    cancel: (id: string) =>
        apiClient.delete(`/room-requests/${id}`),

    notificationCount: () =>
        apiClient.get<{ pending_incoming: number; recent_responses: number }>('/room-requests/notifications/count')
            .then((r) => r.data),
};
