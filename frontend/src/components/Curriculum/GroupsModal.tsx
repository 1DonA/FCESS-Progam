/**
 * "Manage Groups" modal — for a single course.
 *
 * A course can have many groups (sections) of different kinds:
 *   • LECTURE — a lecture group, with its own lecturer
 *   • LAB     — a lab group, with its own lecturer
 *   • TUTORIAL — a tutorial / discussion group
 *   • COMBINED — one group covering both lecture & lab
 *
 * Example layout for ENGR-103: 2 LECTURE groups (2 lecturers) + 6 LAB groups
 * (6 lecturers). The bulk-create form at the bottom of the modal makes this
 * one click.
 */
import { useEffect, useState } from 'react';
import {
    ActionIcon, Badge, Box, Button, Group, Modal, NumberInput, Select, Stack,
    Table, Text, ThemeIcon,
} from '@mantine/core';
import { IconLayersIntersect, IconPlus, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { apiClient } from '../../api/client';
import { confirm, errMsg, toast } from '../../lib/feedback';

interface Section {
    id: string;
    course_id: string;
    semester_id: string;
    section_number: string;
    expected_enrollment: number;
    kind: 'LECTURE' | 'LAB' | 'TUTORIAL' | 'COMBINED';
    lecturer_id: string | null;
}
interface FacultyOpt { id: string; first_name: string; last_name: string; department_id: string; }
interface Semester { id: string; name: string; is_active: boolean; }

interface Props {
    opened: boolean;
    onClose: () => void;
    courseId: string;
    courseCode: string;
    courseDepartmentId: string;
    onChanged?: () => void;
}

const KIND_COLOR: Record<string, string> = {
    LECTURE: 'indigo', LAB: 'teal', TUTORIAL: 'grape', COMBINED: 'yellow',
};

export function GroupsModal({ opened, onClose, courseId, courseCode, courseDepartmentId, onChanged }: Props) {
    const [sections, setSections] = useState<Section[]>([]);
    const [faculty, setFaculty] = useState<FacultyOpt[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [semesterId, setSemesterId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [bulk, setBulk] = useState({ lecture: 2, lab: 0, tutorial: 0, enrollment: 30 });

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [sRes, fRes, semRes] = await Promise.all([
                apiClient.get<Semester[]>('/scheduling/semesters'),
                apiClient.get<FacultyOpt[]>('/catalog/faculty'),
                Promise.resolve(null),
            ]);
            void semRes;
            setSemesters(sRes.data);
            setFaculty(fRes.data);
            const active = sRes.data.find((s) => s.is_active) || sRes.data[0];
            const useSem = semesterId || active?.id || '';
            if (useSem !== semesterId) setSemesterId(useSem);
            if (useSem) {
                const secs = await apiClient.get<Section[]>(`/scheduling/sections?course_id=${courseId}&semester_id=${useSem}`);
                setSections(secs.data);
            }
        } catch (e) { toast.error(errMsg(e, 'Could not load groups.')); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (opened) void fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opened, semesterId]);

    const facultyOptions = faculty
        .filter((f) => !courseDepartmentId || f.department_id === courseDepartmentId)
        .map((f) => ({ value: f.id, label: `${f.first_name} ${f.last_name}` }));

    const updateGroup = async (section: Section, patch: Partial<Section>) => {
        try {
            await apiClient.patch(`/scheduling/sections/${section.id}`, patch);
            await fetchAll();
            onChanged?.();
        } catch (e) { toast.error(errMsg(e, 'Could not update group.')); }
    };

    const deleteGroup = async (s: Section) => {
        const ok = await confirm({
            title: `Delete group ${s.section_number} (${s.kind})?`,
            danger: true,
            confirmLabel: 'Delete group',
            body: <Text size="sm">All scheduled sessions for this group will also be removed.</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/scheduling/sections/${s.id}`);
            await fetchAll();
            onChanged?.();
            toast.success('Group deleted.');
        } catch (e) { toast.error(errMsg(e, 'Could not delete group.')); }
    };

    const addSingleGroup = async (kind: 'LECTURE' | 'LAB' | 'TUTORIAL' | 'COMBINED') => {
        if (!semesterId) { toast.error('Pick a semester first.'); return; }
        const nextNumber = String(Math.max(0, ...sections.map((s) => Number(s.section_number) || 0)) + 1);
        try {
            await apiClient.post('/scheduling/sections', {
                course_id: courseId,
                semester_id: semesterId,
                section_number: nextNumber,
                expected_enrollment: 30,
                kind,
            });
            await fetchAll();
            onChanged?.();
            toast.success(`Added ${kind} group ${nextNumber}.`);
        } catch (e) { toast.error(errMsg(e, 'Could not add group.')); }
    };

    const bulkCreate = async () => {
        if (!semesterId) { toast.error('Pick a semester first.'); return; }
        if (bulk.lecture + bulk.lab + bulk.tutorial === 0) { toast.error('Pick at least one group to create.'); return; }
        try {
            const res = await apiClient.post('/scheduling/sections/bulk-groups', {
                course_id: courseId,
                semester_id: semesterId,
                lecture_groups: bulk.lecture,
                lab_groups: bulk.lab,
                tutorial_groups: bulk.tutorial,
                expected_enrollment: bulk.enrollment,
            });
            toast.success(`Created ${res.data?.created ?? 0} group(s).`);
            await fetchAll();
            onChanged?.();
        } catch (e) { toast.error(errMsg(e, 'Bulk-create failed.')); }
    };

    const counts = {
        LECTURE:  sections.filter((s) => s.kind === 'LECTURE').length,
        LAB:      sections.filter((s) => s.kind === 'LAB').length,
        TUTORIAL: sections.filter((s) => s.kind === 'TUTORIAL').length,
        COMBINED: sections.filter((s) => s.kind === 'COMBINED').length,
    };

    return (
        <Modal opened={opened} onClose={onClose}
            title={
                <Group gap="xs">
                    <ThemeIcon size={28} radius="xl" variant="light" color="brand"><IconLayersIntersect size={15} /></ThemeIcon>
                    <Text fw={700}>Manage groups for {courseCode}</Text>
                </Group>
            }
            centered size="xl" radius="xl">
            <Stack gap="md">
                <Group justify="space-between" wrap="wrap">
                    <Group gap={6}>
                        <Badge color="indigo" variant="light">{counts.LECTURE} lecture</Badge>
                        <Badge color="teal"   variant="light">{counts.LAB} lab</Badge>
                        <Badge color="grape"  variant="light">{counts.TUTORIAL} tutorial</Badge>
                        {counts.COMBINED > 0 && <Badge color="yellow" variant="light">{counts.COMBINED} combined</Badge>}
                    </Group>
                    <Select
                        label="Semester"
                        data={semesters.map((s) => ({ value: s.id, label: s.name + (s.is_active ? ' (active)' : '') }))}
                        value={semesterId}
                        onChange={(v) => setSemesterId(v || '')}
                        style={{ minWidth: 260 }}
                        radius="lg"
                    />
                </Group>

                {/* Existing groups table */}
                <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Existing groups</Text>
                    {sections.length === 0 ? (
                        <Text c="dimmed" size="sm" ta="center" py="md">
                            No groups yet for this semester. Use the buttons below to add some.
                        </Text>
                    ) : (
                        <Table striped highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Group #</Table.Th>
                                    <Table.Th>Kind</Table.Th>
                                    <Table.Th>Lecturer</Table.Th>
                                    <Table.Th>Enrollment</Table.Th>
                                    <Table.Th style={{ width: 60 }}></Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {sections.map((s) => (
                                    <Table.Tr key={s.id}>
                                        <Table.Td><Text fw={700}>§{s.section_number}</Text></Table.Td>
                                        <Table.Td>
                                            <Select
                                                size="xs"
                                                data={['LECTURE', 'LAB', 'TUTORIAL', 'COMBINED']}
                                                value={s.kind}
                                                onChange={(v) => v && updateGroup(s, { kind: v as Section['kind'] })}
                                                renderOption={({ option }) => (
                                                    <Badge color={KIND_COLOR[option.value] || 'gray'} variant="light" size="sm">
                                                        {option.value}
                                                    </Badge>
                                                )}
                                                comboboxProps={{ withinPortal: true }}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <Select
                                                size="xs"
                                                searchable clearable
                                                placeholder="Unassigned"
                                                data={facultyOptions}
                                                value={s.lecturer_id}
                                                onChange={(v) => updateGroup(s, { lecturer_id: v || null })}
                                                comboboxProps={{ withinPortal: true }}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <NumberInput
                                                size="xs" min={1} step={5}
                                                value={s.expected_enrollment}
                                                onChange={(v) => updateGroup(s, { expected_enrollment: Number(v) || 0 })}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <ActionIcon color="red" variant="subtle" size="sm" onClick={() => deleteGroup(s)}>
                                                <IconTrash size={14} />
                                            </ActionIcon>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    )}
                </Box>

                {/* Quick add per-kind */}
                <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Add a single group</Text>
                    <Group gap="xs">
                        <Button size="xs" variant="light" color="indigo" leftSection={<IconPlus size={12} />}
                            onClick={() => addSingleGroup('LECTURE')}>Lecture group</Button>
                        <Button size="xs" variant="light" color="teal" leftSection={<IconPlus size={12} />}
                            onClick={() => addSingleGroup('LAB')}>Lab group</Button>
                        <Button size="xs" variant="light" color="grape" leftSection={<IconPlus size={12} />}
                            onClick={() => addSingleGroup('TUTORIAL')}>Tutorial group</Button>
                        <Button size="xs" variant="light" color="yellow" leftSection={<IconPlus size={12} />}
                            onClick={() => addSingleGroup('COMBINED')}>Combined group</Button>
                    </Group>
                </Box>

                {/* Bulk create */}
                <Box style={{ background: 'rgba(248,250,252,0.7)', padding: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Bulk create</Text>
                    <Group gap="sm" wrap="wrap" align="flex-end">
                        <NumberInput label="Lectures" min={0} max={20} value={bulk.lecture}
                            onChange={(v) => setBulk({ ...bulk, lecture: Number(v) || 0 })}
                            style={{ width: 110 }} />
                        <NumberInput label="Labs" min={0} max={20} value={bulk.lab}
                            onChange={(v) => setBulk({ ...bulk, lab: Number(v) || 0 })}
                            style={{ width: 110 }} />
                        <NumberInput label="Tutorials" min={0} max={20} value={bulk.tutorial}
                            onChange={(v) => setBulk({ ...bulk, tutorial: Number(v) || 0 })}
                            style={{ width: 110 }} />
                        <NumberInput label="Enrollment" min={1} max={500} step={5} value={bulk.enrollment}
                            onChange={(v) => setBulk({ ...bulk, enrollment: Number(v) || 30 })}
                            style={{ width: 130 }} />
                        <Button leftSection={<IconUserPlus size={14} />} onClick={bulkCreate}
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg">
                            Create groups
                        </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mt={6}>
                        Example: <code>2 lectures + 6 labs</code> sets up an ENGR-103-style layout.
                        Assign lecturers to each row in the table above after creating.
                    </Text>
                </Box>

                <Group justify="flex-end">
                    <Button variant="subtle" color="gray" radius="lg" onClick={onClose} loading={loading}>Close</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
