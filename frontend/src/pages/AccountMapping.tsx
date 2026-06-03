/**
 * Account Mapping - admin-only view answering the question:
 *   "Which user account owns which faculty?"
 *
 * Lists every User row with its role, the department they're scoped to
 * (CHAIR / FACULTY), and the lecturer record they're linked to (if any).
 *
 * Admins can edit any user (role / dept / active), reset their password,
 * or delete them entirely from this page.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    ActionIcon, Badge, Box, Container, Group, Modal, Paper, PasswordInput,
    Select, Stack, Switch, Table, Text, TextInput, ThemeIcon, Title, ScrollArea,
    Button, Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconSearch, IconUsers, IconEdit, IconKey, IconTrash,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { usePagedFilter } from '../lib/usePagedFilter';
import { PagedFooter } from '../lib/PagedFooter';

interface UserRow {
    id: string;
    email: string;
    full_name?: string | null;
    role: string;
    is_active: boolean;
    department_id?: string | null;
    department_code?: string | null;
    department_name?: string | null;
    faculty_id?: string | null;
    faculty_name?: string | null;
}

interface DepartmentRow { id: string; code: string; name: string; parent_id?: string | null; }

const ROLE_COLOR: Record<string, string> = {
    ADMIN: 'red',
    CHAIR: 'indigo',
    FACULTY: 'teal',
};

export function AccountMapping() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [departments, setDepartments] = useState<DepartmentRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<string | null>(null);
    const [deptFilter, setDeptFilter] = useState<string | null>(null);

    // Edit user modal state
    const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
    const [editing, setEditing] = useState<UserRow | null>(null);
    const [editForm, setEditForm] = useState<{ full_name: string; role: string; is_active: boolean; department_id: string | null }>({
        full_name: '', role: 'FACULTY', is_active: true, department_id: null,
    });
    const [savingEdit, setSavingEdit] = useState(false);

    // Reset password modal state
    const [pwdOpened, { open: openPwd, close: closePwd }] = useDisclosure(false);
    const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
    const [pwd, setPwd] = useState('');
    const [pwdSaving, setPwdSaving] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const r = await apiClient.get<UserRow[]>('/auth/users');
            setUsers(r.data);
        } catch (e) { toast.error(errMsg(e, 'Could not load users.')); }
        finally { setLoading(false); }
    };
    const fetchDepts = async () => {
        try {
            const r = await apiClient.get<DepartmentRow[]>('/catalog/departments');
            setDepartments(r.data);
        } catch { /* optional */ }
    };

    useEffect(() => { void fetchUsers(); void fetchDepts(); }, []);

    const deptOptions = useMemo(() => {
        const seen = new Set<string>();
        const out: { value: string; label: string }[] = [];
        users.forEach((u) => {
            if (u.department_code && !seen.has(u.department_code)) {
                seen.add(u.department_code);
                out.push({ value: u.department_code, label: `${u.department_code} - ${u.department_name ?? ''}` });
            }
        });
        return out.sort((a, b) => a.label.localeCompare(b.label));
    }, [users]);

    const allDeptOptions = useMemo(() => {
        return departments.map((d) => ({ value: d.id, label: `${d.code} - ${d.name}` }));
    }, [departments]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return users.filter((u) => {
            if (roleFilter && (u.role || '').toUpperCase() !== roleFilter) return false;
            if (deptFilter && u.department_code !== deptFilter) return false;
            if (!q) return true;
            return (
                u.email.toLowerCase().includes(q) ||
                (u.full_name ?? '').toLowerCase().includes(q) ||
                (u.faculty_name ?? '').toLowerCase().includes(q) ||
                (u.department_name ?? '').toLowerCase().includes(q) ||
                (u.department_code ?? '').toLowerCase().includes(q)
            );
        });
    }, [users, search, roleFilter, deptFilter]);

    const paged = usePagedFilter<UserRow>(filtered, { defaultPageSize: 25 });

    const counts = {
        admin: users.filter((u) => (u.role || '').toUpperCase() === 'ADMIN').length,
        chair: users.filter((u) => (u.role || '').toUpperCase() === 'CHAIR').length,
        faculty: users.filter((u) => (u.role || '').toUpperCase() === 'FACULTY').length,
        unlinked: users.filter((u) => !u.department_id && (u.role || '').toUpperCase() !== 'ADMIN').length,
    };

    const startEdit = (u: UserRow) => {
        setEditing(u);
        setEditForm({
            full_name: u.full_name || '',
            role: (u.role || 'FACULTY').toUpperCase(),
            is_active: !!u.is_active,
            department_id: u.department_id || null,
        });
        openEdit();
    };

    const saveEdit = async () => {
        if (!editing) return;
        setSavingEdit(true);
        try {
            await apiClient.patch(`/auth/users/${editing.id}`, {
                full_name: editForm.full_name || null,
                role: editForm.role,
                is_active: editForm.is_active,
                department_id: editForm.department_id,
            });
            toast.success(`Updated ${editing.email}.`);
            closeEdit();
            setEditing(null);
            void fetchUsers();
        } catch (e) {
            toast.error(errMsg(e, 'Could not update user.'));
        } finally { setSavingEdit(false); }
    };

    const startPwd = (u: UserRow) => {
        setPwdTarget(u);
        setPwd('');
        openPwd();
    };
    const savePwd = async () => {
        if (!pwdTarget) return;
        if (!pwd || pwd.length < 4) {
            toast.error('Password must be at least 4 characters.');
            return;
        }
        setPwdSaving(true);
        try {
            await apiClient.post(`/auth/users/${pwdTarget.id}/password`, { new_password: pwd });
            toast.success(`Password reset for ${pwdTarget.email}.`);
            closePwd(); setPwdTarget(null); setPwd('');
        } catch (e) {
            toast.error(errMsg(e, 'Could not reset password.'));
        } finally { setPwdSaving(false); }
    };

    const handleDelete = async (u: UserRow) => {
        const ok = await confirm({
            title: `Delete ${u.email}?`,
            danger: true,
            confirmLabel: 'Delete user',
            body: <Text size="sm">This permanently removes the account. The user will not be able to log in again.</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/auth/users/${u.id}`);
            toast.success(`Deleted ${u.email}.`);
            void fetchUsers();
        } catch (e) {
            toast.error(errMsg(e, 'Could not delete user.'));
        }
    };

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group justify="space-between" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconUsers size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Admin</Text>
                                    <Title order={2}>Account Mapping</Title>
                                    <Text size="sm" c="dimmed">
                                        Edit, reset password, or delete any user account.
                                    </Text>
                                </Box>
                            </Group>
                            <Group gap={6}>
                                <Badge color="red"    variant="light">{counts.admin} admin</Badge>
                                <Badge color="indigo" variant="light">{counts.chair} chair</Badge>
                                <Badge color="teal"   variant="light">{counts.faculty} faculty</Badge>
                                {counts.unlinked > 0 && (
                                    <Badge color="orange" variant="light">{counts.unlinked} unlinked</Badge>
                                )}
                            </Group>
                        </Group>
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md" wrap="wrap">
                            <TextInput
                                placeholder="Search email, name, or department..."
                                leftSection={<IconSearch size={14} />}
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                radius="lg"
                                style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
                            />
                            <Select
                                placeholder="All roles"
                                value={roleFilter}
                                onChange={setRoleFilter}
                                data={[
                                    { value: 'ADMIN',   label: 'Admin' },
                                    { value: 'CHAIR',   label: 'Department Chair' },
                                    { value: 'FACULTY', label: 'Lecturer' },
                                ]}
                                clearable radius="lg" style={{ minWidth: 200 }}
                            />
                            <Select
                                placeholder="All departments"
                                value={deptFilter}
                                onChange={setDeptFilter}
                                data={deptOptions}
                                searchable clearable radius="lg" style={{ minWidth: 260 }}
                            />
                        </Group>

                        <ScrollArea>
                            <Table striped highlightOnHover verticalSpacing="sm">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Email</Table.Th>
                                        <Table.Th>Full name</Table.Th>
                                        <Table.Th>Role</Table.Th>
                                        <Table.Th>Linked department</Table.Th>
                                        <Table.Th>Linked lecturer</Table.Th>
                                        <Table.Th>Active</Table.Th>
                                        <Table.Th style={{ width: 130 }}>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {loading ? null : paged.visible.length === 0 ? (
                                        <Table.Tr>
                                            <Table.Td colSpan={7}>
                                                <Text c="dimmed" ta="center" py="lg">No accounts match your filters.</Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ) : paged.visible.map((u) => (
                                        <Table.Tr key={u.id}>
                                            <Table.Td><Text fw={600} size="sm">{u.email}</Text></Table.Td>
                                            <Table.Td>{u.full_name || <Text c="dimmed" size="xs">-</Text>}</Table.Td>
                                            <Table.Td>
                                                <Badge color={ROLE_COLOR[u.role] || 'gray'} variant="light" size="sm">{u.role}</Badge>
                                            </Table.Td>
                                            <Table.Td>
                                                {u.department_code ? (
                                                    <>
                                                        <Badge variant="light" color="brand" size="sm" radius="sm">{u.department_code}</Badge>
                                                        <Text size="xs" c="dimmed" mt={2}>{u.department_name}</Text>
                                                    </>
                                                ) : <Text c="dimmed" size="xs">- not linked -</Text>}
                                            </Table.Td>
                                            <Table.Td>{u.faculty_name || <Text c="dimmed" size="xs">- not linked -</Text>}</Table.Td>
                                            <Table.Td>
                                                {u.is_active
                                                    ? <Badge color="teal" variant="light" size="sm">Active</Badge>
                                                    : <Badge color="gray" variant="light" size="sm">Disabled</Badge>}
                                            </Table.Td>
                                            <Table.Td>
                                                <Group gap={4} wrap="nowrap">
                                                    <Tooltip label="Edit user">
                                                        <ActionIcon variant="light" color="brand" size="sm" onClick={() => startEdit(u)}>
                                                            <IconEdit size={14} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                    <Tooltip label="Reset password">
                                                        <ActionIcon variant="light" color="indigo" size="sm" onClick={() => startPwd(u)}>
                                                            <IconKey size={14} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                    <Tooltip label="Delete user">
                                                        <ActionIcon variant="light" color="red" size="sm" onClick={() => handleDelete(u)}>
                                                            <IconTrash size={14} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </ScrollArea>

                        <PagedFooter
                            page={paged.page}
                            totalPages={paged.totalPages}
                            pageSize={paged.pageSize}
                            totalFiltered={paged.totalFiltered}
                            totalRaw={paged.totalRaw}
                            onPageChange={paged.setPage}
                            onPageSizeChange={paged.setPageSize}
                        />
                    </Paper>
                </Stack>
            </Container>

            <Modal opened={editOpened} onClose={closeEdit} title={`Edit ${editing?.email ?? ''}`} radius="xl" centered>
                <Stack gap="md">
                    <TextInput
                        label="Full name"
                        value={editForm.full_name}
                        onChange={(e) => setEditForm({ ...editForm, full_name: e.currentTarget.value })}
                        radius="lg"
                    />
                    <Select
                        label="Role"
                        value={editForm.role}
                        onChange={(v) => setEditForm({ ...editForm, role: v ?? 'FACULTY' })}
                        data={[
                            { value: 'ADMIN',   label: 'ADMIN' },
                            { value: 'CHAIR',   label: 'CHAIR (Department Chair)' },
                            { value: 'FACULTY', label: 'FACULTY (Lecturer)' },
                        ]}
                        radius="lg"
                    />
                    <Select
                        label="Linked department"
                        placeholder="Leave empty for no link"
                        value={editForm.department_id}
                        onChange={(v) => setEditForm({ ...editForm, department_id: v })}
                        data={allDeptOptions}
                        clearable searchable radius="lg"
                    />
                    <Switch
                        label="Account is active"
                        checked={editForm.is_active}
                        onChange={(e) => setEditForm({ ...editForm, is_active: e.currentTarget.checked })}
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" radius="lg" onClick={closeEdit}>Cancel</Button>
                        <Button onClick={saveEdit} loading={savingEdit} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal opened={pwdOpened} onClose={closePwd} title={`Reset password for ${pwdTarget?.email ?? ''}`} radius="xl" centered>
                <Stack gap="md">
                    <PasswordInput
                        label="New password"
                        value={pwd}
                        onChange={(e) => setPwd(e.currentTarget.value)}
                        placeholder="At least 4 characters"
                        radius="lg"
                        autoFocus
                    />
                    <Text size="xs" c="dimmed">
                        Share the new password with the user securely. They can change it later by asking an admin to reset it again.
                    </Text>
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" radius="lg" onClick={closePwd}>Cancel</Button>
                        <Button onClick={savePwd} loading={pwdSaving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}
                            disabled={pwd.length < 4}>
                            Save password
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
