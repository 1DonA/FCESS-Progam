import { useEffect, useState } from 'react';
import { ActionIcon, AppShell, Badge, Box, Burger, Button, Group, Indicator, NavLink, Paper, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconCalendarTime, IconDashboard, IconLogout, IconSchool,
    IconBuilding, IconDoor, IconBuildingSkyscraper,
    IconUser, IconChartBar, IconAlertTriangle, IconCalendarStats,
    IconLink, IconBuildingWarehouse, IconUsersGroup, IconCertificate,
    IconUserCircle, IconBolt, IconBell, IconHome,
} from '@tabler/icons-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { roomRequestsApi } from '../api/roomRequests';

export function MainLayout({ children }: { children: React.ReactNode }) {
    const [opened, { toggle }] = useDisclosure();
    const navigate = useNavigate();
    const location = useLocation();
    const { logout, me, isFaculty, isAdmin, isAuthenticated } = useAuth();

    // Live conflict count for the sidebar badge.
    const [conflictCount, setConflictCount] = useState<number>(0);
    // Live room-request notification count (incoming pending requests).
    const [pendingRequests, setPendingRequests] = useState<number>(0);

    useEffect(() => {
        if (!isAuthenticated) return;
        const refresh = async () => {
            try {
                const n = await roomRequestsApi.notificationCount();
                setPendingRequests(n.pending_incoming || 0);
            } catch { /* silent */ }
        };
        void refresh();
        const id = setInterval(refresh, 30_000);
        return () => clearInterval(id);
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) return;
        const refresh = async () => {
            try {
                const s = await apiClient.get('/scheduling/semesters');
                const active = (s.data || []).find((x: any) => x.is_active) || (s.data || [])[0];
                if (!active) return;
                const c = await apiClient.get(`/scheduling/conflicts/${active.id}`);
                setConflictCount(c.data?.conflict_count ?? 0);
            } catch { /* silent */ }
        };
        void refresh();
        const id = setInterval(refresh, 60_000);
        return () => clearInterval(id);
    }, [isAuthenticated]);

    const navGroups = isFaculty ? [
        {
            label: 'My Workspace',
            items: [
                { label: 'My Schedule',    path: '/my',              icon: <IconUserCircle size="1.1rem" stroke={1.8} /> },
                { label: 'My Department',  path: '/yearly-schedule', icon: <IconCalendarStats size="1.1rem" stroke={1.8} /> },
                { label: 'Curriculum',     path: '/curriculum',      icon: <IconCertificate size="1.1rem" stroke={1.8} /> },
                { label: 'Faculty Load',   path: '/faculty-load',    icon: <IconChartBar size="1.1rem" stroke={1.8} /> },
                { label: 'Room Requests',  path: '/room-requests',   icon: <IconHome size="1.1rem" stroke={1.8} /> },
            ],
        },
    ] : [
        {
            label: 'Catalog',
            items: [
                { label: 'Dashboard',     path: '/',              icon: <IconDashboard size="1.1rem" stroke={1.8} /> },
                { label: 'Faculties',     path: '/departments',   icon: <IconBuildingSkyscraper size="1.1rem" stroke={1.8} /> },
                { label: 'Courses',       path: '/courses',       icon: <IconSchool size="1.1rem" stroke={1.8} /> },
                { label: 'Lecturers',     path: '/faculty',       icon: <IconBuilding size="1.1rem" stroke={1.8} /> },
                { label: 'Assignments',   path: '/assignments',   icon: <IconUsersGroup size="1.1rem" stroke={1.8} /> },
                { label: 'Rooms',         path: '/rooms',         icon: <IconDoor size="1.1rem" stroke={1.8} /> },
                { label: 'Prerequisites', path: '/prerequisites', icon: <IconLink size="1.1rem" stroke={1.8} /> },
                { label: 'Curriculum',    path: '/curriculum',    icon: <IconCertificate size="1.1rem" stroke={1.8} /> },
            ]
        },
        {
            label: 'Scheduling',
            items: [
                { label: 'Scheduling',         path: '/scheduling',       icon: <IconCalendarTime size="1.1rem" stroke={1.8} /> },
                { label: 'Yearly Schedule',    path: '/yearly-schedule',  icon: <IconCalendarStats size="1.1rem" stroke={1.8} /> },
                { label: 'Faculty Schedule',   path: '/faculty-schedule', icon: <IconUser size="1.1rem" stroke={1.8} /> },
                { label: 'Conflict Detection', path: '/conflicts',        icon: <IconAlertTriangle size="1.1rem" stroke={1.8} /> },
                { label: 'Room Requests',      path: '/room-requests',    icon: <IconHome size="1.1rem" stroke={1.8} /> },
            ]
        },
        {
            label: 'Reports',
            items: [
                { label: 'Faculty Load',     path: '/faculty-load',     icon: <IconChartBar size="1.1rem" stroke={1.8} /> },
                { label: 'Room Utilization', path: '/room-utilization', icon: <IconBuildingWarehouse size="1.1rem" stroke={1.8} /> },
            ]
        },
        ...(isAdmin ? [{
            label: 'Admin',
            items: [
                { label: 'Account Mapping', path: '/account-mapping', icon: <IconUser size="1.1rem" stroke={1.8} /> },
            ]
        }] : [])
    ];

    return (
        <AppShell
            header={{ height: 65 }}
            navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !opened } }}
            padding="md"
            styles={(theme) => ({
                main: { background: 'linear-gradient(180deg, rgba(249,251,255,0.72) 0%, rgba(235,242,250,0.92) 100%)', minHeight: '100vh' },
                header: { borderBottom: `1px solid ${theme.colors.slate[2]}`, backgroundColor: 'rgba(248,251,255,0.82)', backdropFilter: 'blur(18px)', boxShadow: '0 16px 48px -36px rgba(15,23,42,0.32)' },
                navbar: { borderRight: `1px solid ${theme.colors.slate[2]}`, backgroundColor: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(18px)' }
            })}
        >
            <AppShell.Header>
                <Group h="100%" px="xl" justify="space-between">
                    <Group gap="sm" wrap="nowrap">
                        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
                        <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            <IconCalendarTime size={18} />
                        </ThemeIcon>
                        <Box>
                            <Group gap={6} align="center">
                                <Text fw={800}>
                                    {isAdmin ? 'FCESS Admin'
                                      : isFaculty ? `FCESS — ${me?.faculty_first_name ?? ''} ${me?.faculty_last_name ?? ''}`.trim() || 'FCESS Lecturer'
                                      : 'FCESS Chair'}
                                </Text>
                                <Badge color="teal" variant="dot" size="xs" leftSection={<IconBolt size={9} />}>
                                    Live
                                </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">
                                {me?.department_code
                                    ? `${me.department_code} · ${(me.role || '').toLowerCase()}`
                                    : 'Academic scheduling workspace'}
                            </Text>
                        </Box>
                    </Group>
                    <Group gap="xs">
                        <Tooltip label={pendingRequests > 0
                            ? `${pendingRequests} pending room request${pendingRequests === 1 ? '' : 's'}`
                            : 'No pending room requests'}>
                            <Indicator color="red" disabled={pendingRequests === 0}
                                       label={pendingRequests > 0 ? String(pendingRequests) : undefined}
                                       size={pendingRequests > 9 ? 16 : 14} offset={4} inline>
                                <ActionIcon variant="light" color={pendingRequests > 0 ? 'red' : 'gray'}
                                            size="lg" radius="lg" onClick={() => navigate('/room-requests')}>
                                    <IconBell size={18} />
                                </ActionIcon>
                            </Indicator>
                        </Tooltip>
                        <Button
                            leftSection={<IconLogout size="1rem" stroke={1.5} />}
                            variant="light"
                            color="red"
                            size="sm"
                            radius="lg"
                            onClick={logout}
                        >
                            Logout
                        </Button>
                    </Group>
                </Group>
            </AppShell.Header>

            <AppShell.Navbar p="md" style={{ overflowY: 'auto' }}>
                <Stack gap="xs">
                    <Paper p="md" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(237,244,255,0.96) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Navigation</Text>
                        <Text size="xs" c="dimmed">Manage scheduling, catalog, and infrastructure.</Text>
                    </Paper>

                    {navGroups.map(group => (
                        <Box key={group.label}>
                            <Text size="xs" fw={700} tt="uppercase" c="dimmed" px="xs" mb={2}>{group.label}</Text>
                            {group.items.map(item => {
                                const showConflictBadge = item.path === '/conflicts' && conflictCount > 0;
                                const showRequestBadge  = item.path === '/room-requests' && pendingRequests > 0;
                                const badgeN = showConflictBadge ? conflictCount : (showRequestBadge ? pendingRequests : 0);
                                return (
                                    <NavLink
                                        key={item.path}
                                        label={item.label}
                                        leftSection={item.icon}
                                        rightSection={badgeN > 0 ? (
                                            <Badge color="red" variant="filled" size="xs" circle>
                                                {badgeN}
                                            </Badge>
                                        ) : undefined}
                                        active={location.pathname === item.path}
                                        onClick={() => navigate(item.path)}
                                        variant={location.pathname === item.path ? 'filled' : 'light'}
                                        color="brand"
                                        styles={(theme) => ({
                                            root: { borderRadius: theme.radius.lg, fontWeight: 600 },
                                            label: { fontWeight: 600 },
                                        })}
                                    />
                                );
                            })}
                        </Box>
                    ))}
                </Stack>
            </AppShell.Navbar>

            <AppShell.Main>{children}</AppShell.Main>
        </AppShell>
    );
}
