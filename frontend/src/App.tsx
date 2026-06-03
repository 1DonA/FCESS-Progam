import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Courses } from './pages/Courses';
import { Faculty } from './pages/Faculty';
import { Departments } from './pages/Departments';
import { Rooms } from './pages/Rooms';
import { Scheduling } from './pages/Scheduling';
import { Assignments } from './pages/Assignments';
import { MainLayout } from './components/MainLayout';
import { FacultySchedule } from './pages/FacultySchedule';
import { FacultyLoadReport } from './pages/FacultyLoadReport';
import { Conflicts } from './pages/Conflicts';
import { YearlySchedule } from './pages/YearlySchedule';
import { Prerequisites } from './pages/Prerequisites';
import { Curriculum } from './pages/Curriculum';
import { RoomUtilization } from './pages/RoomUtilization';
import { Signup } from './pages/Signup';
import { LecturerPortal } from './pages/LecturerPortal';
import { RoomRequests } from './pages/RoomRequests';
import { AccountMapping } from './pages/AccountMapping';

function ProtectedRoute({ children }: { children: ReactElement }) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return children;
}

function Wrap({ children }: { children: ReactElement }) {
    return <ProtectedRoute><MainLayout>{children}</MainLayout></ProtectedRoute>;
}

function AdminOnly({ children }: { children: ReactElement }) {
    const { isFaculty } = useAuth();
    if (isFaculty) return <Navigate to="/my" replace />;
    return children;
}

function AdminTrueOnly({ children }: { children: ReactElement }) {
    const { isAdmin, isFaculty } = useAuth();
    if (isFaculty) return <Navigate to="/my" replace />;
    if (!isAdmin) return <Navigate to="/" replace />;
    return children;
}

function HomeRouter() {
    const { isFaculty } = useAuth();
    return isFaculty ? <Wrap><LecturerPortal /></Wrap> : <Wrap><Dashboard /></Wrap>;
}

function AppContent() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/" element={<HomeRouter />} />
            <Route path="/my" element={<Wrap><LecturerPortal /></Wrap>} />
            <Route path="/departments"      element={<Wrap><AdminOnly><Departments /></AdminOnly></Wrap>} />
            <Route path="/courses"          element={<Wrap><AdminOnly><Courses /></AdminOnly></Wrap>} />
            <Route path="/faculty"          element={<Wrap><AdminOnly><Faculty /></AdminOnly></Wrap>} />
            <Route path="/rooms"            element={<Wrap><AdminOnly><Rooms /></AdminOnly></Wrap>} />
            <Route path="/scheduling"       element={<Wrap><AdminOnly><Scheduling /></AdminOnly></Wrap>} />
            <Route path="/assignments"      element={<Wrap><AdminOnly><Assignments /></AdminOnly></Wrap>} />
            <Route path="/faculty-schedule" element={<Wrap><FacultySchedule /></Wrap>} />
            <Route path="/faculty-load"     element={<Wrap><FacultyLoadReport /></Wrap>} />
            <Route path="/conflicts"        element={<Wrap><AdminOnly><Conflicts /></AdminOnly></Wrap>} />
            <Route path="/yearly-schedule"  element={<Wrap><YearlySchedule /></Wrap>} />
            <Route path="/prerequisites"    element={<Wrap><AdminOnly><Prerequisites /></AdminOnly></Wrap>} />
            <Route path="/curriculum"       element={<Wrap><Curriculum /></Wrap>} />
            <Route path="/room-utilization" element={<Wrap><AdminOnly><RoomUtilization /></AdminOnly></Wrap>} />
            <Route path="/room-requests"    element={<Wrap><RoomRequests /></Wrap>} />
            <Route path="/account-mapping"  element={<Wrap><AdminTrueOnly><AccountMapping /></AdminTrueOnly></Wrap>} />
        </Routes>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
