import { useEffect, useState } from 'react';
import {
    ActionIcon, Badge, Box, Button, Container, Group, Modal, MultiSelect,
    NumberInput, Paper, Select, Skeleton, Stack, Table, Text, TextInput,
    ThemeIcon, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
    IconPlus, IconSchool, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { EditRowButton } from '../lib/EditRowButton';
import { DeleteAllButton } from '../lib/DeleteAllButton';
import { usePagedFilter } from '../lib/usePagedFilter';
import { PagedFooter } from '../lib/PagedFooter';

interface Course {
    id: string;
    code: string;
    title: string;
    credit_hours: number;
    lecture_hours: number;
    tutorial_hours?: number;
    lab_hours: number;
    department_id: string;
    curriculum_year: number;
    course_type?: string | null;
    workload?: number | null;
}

interface Department { id: string; code: string; name: string; }
interface Prerequisite { id: string; course_id: string; prerequisite_course_id: string; }

// FIU course categories (full name + abbreviation in label so it reads "Faculty Elective (FE)").
const COURSE_TYPES = [
    { value: 'UC', label: 'University Core (UC)' },
    { value: 'FC', label: 'Faculty Core (FC)' },
    { value: 'AC', label: 'Area Core (AC)' },
    { value: 'AE', label: 'Area Elective (AE)' },
    { value: 'FE', label: 'Faculty Elective (FE)' },
    { value: 'UE', label: 'University Elective (UE)' },
];

const TYPE_FULL: Record<string, string> = {
    UC: 'University Core', FC: 'Faculty Core', AC: 'Area Core',
    AE: 'Area Elective', FE: 'Faculty Elective', UE: 'University Elective',
    CORE: 'Core', ELECTIVE: 'Elective', GENERAL: 'General',
};

// Map any stored value to its short abbreviation for the Type column badge.
// FIU codes stay as-is; legacy values get shortened so the badge is always compact.
const TYPE_ABBR: Record<string, string> = {
    UC: 'UC', FC: 'FC', AC: 'AC', AE: 'AE', FE: 'FE', UE: 'UE',
    CORE: 'C', ELECTIVE: 'E', GENERAL: 'G',
};
const toAbbr = (t?: string | null) => {
    const u = (t || '').toUpperCase();
    return TYPE_ABBR[u] || u;
};

const typeColor = (t?: string | null) => {
    switch ((t || '').toUpperCase()) {
        case 'UC': return 'grape';
        case 'FC': case 'CORE': return 'teal';
        case 'AC': return 'indigo';
        case 'AE': case 'ELECTIVE': return 'yellow';
        case 'FE': return 'orange';
        case 'UE': return 'pink';
        case 'GENERAL': return 'blue';
        default: return 'gray';
    }
};

export function Courses() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [prereqsByCourse, setPrereqsByCourse] = useState<Record<string, string[]>>({});
    const [lecturerCount, setLecturerCount] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState('');
    const [deptFilter, setDeptFilter] = useState<string | null>(null);
    const [debouncedSearch] = useDebouncedValue(search, 200);
    const paged = usePagedFilter<any>(courses, {
        searchFields: ['code', 'title'],
        defaultPageSize: 25,
    });

    const blankForm = {
        code: '', title: '', department_id: '',
        credit_hours: 3, lecture_hours: 3, tutorial_hours: 0, lab_hours: 0,
        curriculum_year: 1, course_type: '' as string,
        prerequisites: [] as string[],
    };
    const [form, setForm] = useState(blankForm);

    useEffect(() => {
        void fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, deptFilter]);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const params: Record<string, string> = {};
            if (debouncedSearch) params.q = debouncedSearch;
            if (deptFilter) params.department_id = deptFilter;
            const [cRes, dRes, pRes, aRes] = await Promise.all([
                apiClient.get<Course[]>('/catalog/courses', { params }),
                apiClient.get<Department[]>('/catalog/departments'),
                apiClient.get<Prerequisite[]>('/catalog/prerequisites'),
                apiClient.get<{course_id: string}[]>('/catalog/assignments'),
            ]);
            const counts: Record<string, number> = {};
            (aRes.data || []).forEach((a: any) => {
                counts[a.course_id] = (counts[a.course_id] || 0) + 1;
            });
            setLecturerCount(counts);
            setCourses(cRes.data);
            setDepartments(dRes.data);

            const codeById: Record<string, string> = {};
            const fullCourses = await apiClient.get<Course[]>('/catalog/courses');
            fullCourses.data.forEach((c) => { codeById[c.id] = c.code; });
            const map: Record<string, string[]> = {};
            pRes.data.forEach((p) => {
                const code = codeById[p.prerequisite_course_id] ?? '?';
                if (!map[p.course_id]) map[p.course_id] = [];
                map[p.course_id].push(code);
            });
            setPrereqsByCourse(map);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load courses.'));
        } finally {
            setIsLoading(false);
        }
    };

    const openAdd = () => {
        setForm({ ...blankForm, department_id: departments[0]?.id ?? '' });
        open();
    };

    const handleAdd = async () => {
        if (!form.code.trim() || !form.title.trim() || !form.department_id) {
            toast.error('Code, title, and department are required.');
            return;
        }
        setSaving(true);
        try {
            const created = await apiClient.post<Course>('/catalog/courses', {
                code: form.code.toUpperCase().trim(),
                title: form.title.trim(),
                department_id: form.department_id,
                credit_hours: Number(form.credit_hours) || 0,
                lecture_hours: Number(form.lecture_hours) || 0,
                tutorial_hours: Number(form.tutorial_hours) || 0,
                lab_hours: Number(form.lab_hours) || 0,
                curriculum_year: Number(form.curriculum_year) || 1,
                course_type: form.course_type || null,
            });
            let prereqOk = 0;
            for (const code of form.prerequisites) {
                const prereq = courses.find((c) => c.code === code);
                if (!prereq || prereq.id === created.data.id) continue;
                try {
                    await apiClient.post('/scheduling/prerequisites', {
                        course_id: created.data.id,
                        prerequisite_course_id: prereq.id,
                    });
                    prereqOk += 1;
                } catch (e) {
                    toast.warn(`Prereq ${code}: ${errMsg(e, 'could not link')}`);
                }
            }
            toast.success(
                `Course ${created.data.code} created${prereqOk ? `, ${prereqOk} prerequisite${prereqOk === 1 ? '' : 's'} linked` : ''}.`,
            );
            close();
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not create course.'));
        } finally {
            setSaving(false);
        }
    };

    const confirmDeleteCourse = async (id: string, code: string) => {
        const ok = await confirm({
            title: `Delete course ${code}?`,
            danger: true,
            confirmLabel: 'Delete course',
            body: <Text size="sm">This removes the course, its sections, sessions, prerequisites and lecturer assignments.</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/catalog/courses/${id}`);
            toast.success(`Course ${code} deleted.`);
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not delete course.'));
        }
    };

    const deptCode = (id: string) => departments.find((d) => d.id === id)?.code ?? '?';

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconSchool size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Curriculum</Text>
                                    <Title order={2}>Courses</Title>
                                    <Text size="xs" c="dimmed">Each course shows its ECTS, hours (L / T / Lab), FIU category and prerequisites.</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <ImportCsvButton entity="courses" onImported={fetchAll} />
                                <DeleteAllButton scope="courses" label="Delete all courses" cascade onDone={fetchAll} />
                                <Button leftSection={<IconPlus size={16} />} onClick={openAdd} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg">
                                    Add Course
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md" wrap="wrap">
                            <TextInput
                                placeholder="Search code or title..."
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                leftSection={<IconSearch size={14} />}
                                radius="lg"
                                style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                            />
                            <Select
                                placeholder="All departments"
                                value={deptFilter}
                                onChange={setDeptFilter}
                                data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                                clearable
                                radius="lg"
                                style={{ minWidth: 220 }}
                            />
                        </Group>

                        {isLoading ? (
                            <Stack gap="sm">{[1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}</Stack>
                        ) : courses.length === 0 ? (
                            <Stack align="center" py="xl" gap="sm">
                                <Text c="dimmed">No courses match your filters. Import a CSV or add one above.</Text>
                            </Stack>
                        ) : (
                            <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="sm" stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Code</Table.Th>
                                        <Table.Th>Title</Table.Th>
                                        <Table.Th>Dept</Table.Th>
                                        <Table.Th>Year</Table.Th>
                                        <Table.Th>Credits</Table.Th>
                                        <Table.Th>L / T / Lab</Table.Th>
                                        <Table.Th>Type</Table.Th>
                                        <Table.Th>Lecturers</Table.Th>
                                        <Table.Th>Prerequisites</Table.Th>
                                        <Table.Th style={{ width: 50 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {paged.visible.map((c) => {
                                        const prereqs = prereqsByCourse[c.id] ?? [];
                                        return (
                                            <Table.Tr key={c.id}>
                                                <Table.Td><Badge variant="light" color="brand" radius="sm" fw={700}>{c.code}</Badge></Table.Td>
                                                <Table.Td><Text fw={500}>{c.title}</Text></Table.Td>
                                                <Table.Td>{deptCode(c.department_id)}</Table.Td>
                                                <Table.Td>{c.curriculum_year}</Table.Td>
                                                <Table.Td><Badge variant="light" color="indigo" radius="sm">{c.credit_hours} cr</Badge></Table.Td>
                                                <Table.Td><Text size="sm"><strong>{c.lecture_hours}</strong>L / <strong>{c.tutorial_hours ?? 0}</strong>T / <strong>{c.lab_hours}</strong>Lab</Text></Table.Td>
                                                <Table.Td>
                                                    {c.course_type
                                                        ? <Badge variant="light" color={typeColor(c.course_type)} radius="sm" title={TYPE_FULL[c.course_type.toUpperCase()] || c.course_type}>{toAbbr(c.course_type)}</Badge>
                                                        : <Text c="dimmed" size="xs">—</Text>}
                                                </Table.Td>
                                                <Table.Td>
                                                  {lecturerCount[c.id]
                                                    ? <Badge variant="light" color={lecturerCount[c.id] > 1 ? 'teal' : 'gray'} radius="sm">{lecturerCount[c.id]} {lecturerCount[c.id] === 1 ? 'lecturer' : 'lecturers'}</Badge>
                                                    : <Text c="dimmed" size="xs">—</Text>}
                                                </Table.Td>
                                                <Table.Td>
                                                    {prereqs.length === 0
                                                        ? <Text c="dimmed" size="xs">none</Text>
                                                        : (
                                                            <Group gap={4} wrap="wrap">
                                                                {prereqs.map((p) => (
                                                                    <Badge key={p} variant="default" radius="sm" size="xs">{p}</Badge>
                                                                ))}
                                                            </Group>
                                                        )}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap={4}>
                                                        <EditRowButton
                                                            title={`Edit course ${c.code}`}
                                                            endpoint={`/catalog/courses/${c.id}`}
                                                            fields={[
                                                                { name: 'code',  label: 'Code',  value: c.code },
                                                                { name: 'title', label: 'Title', value: c.title },
                                                                { kind: 'select', name: 'department_id', label: 'Department', value: c.department_id,
                                                                    options: departments.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` })), searchable: true },
                                                                { kind: 'number', name: 'curriculum_year', label: 'Curriculum year', value: c.curriculum_year, min: 1 },
                                                                { kind: 'number', name: 'credit_hours',    label: 'Credits',          value: c.credit_hours,           min: 0, step: 0.5 },
                                                                { kind: 'number', name: 'lecture_hours',   label: 'Lecture h/week',   value: c.lecture_hours,          min: 0 },
                                                                { kind: 'number', name: 'tutorial_hours',  label: 'Tutorial h/week',  value: Number(c.tutorial_hours ?? 0), min: 0 },
                                                                { kind: 'number', name: 'lab_hours',       label: 'Lab h/week',       value: c.lab_hours,              min: 0 },
                                                                { kind: 'select', name: 'course_type', label: 'Course type', value: (c.course_type || '').toUpperCase() || 'FC',
                                                                    options: COURSE_TYPES },
                                                            ]}
                                                            onSaved={fetchAll}
                                                        />
                                                        <ActionIcon color="red" variant="subtle" size="sm" onClick={() => confirmDeleteCourse(c.id, c.code)}>
                                                            <IconTrash size={15} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        )}
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

            <Modal opened={opened} onClose={close} title="Add Course" radius="xl" centered size="lg">
                <Stack gap="md">
                    <Group grow>
                        <TextInput label="Code" placeholder="CS101" required radius="lg"
                            value={form.code}
                            onChange={(e) => setForm({ ...form, code: e.target.value })} />
                        <TextInput label="Title" placeholder="Intro to Programming" required radius="lg"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </Group>
                    <Group grow>
                        <Select label="Department" required radius="lg"
                            value={form.department_id}
                            onChange={(v) => setForm({ ...form, department_id: v ?? '' })}
                            data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))} />
                        <NumberInput label="Curriculum year" min={1} max={6} radius="lg"
                            value={form.curriculum_year}
                            onChange={(v) => setForm({ ...form, curriculum_year: Number(v) || 1 })} />
                    </Group>
                    <Group grow>
                        <NumberInput label="Credits" step={0.5} min={0} radius="lg" description="ECTS / credit hours"
                            value={form.credit_hours}
                            onChange={(v) => setForm({ ...form, credit_hours: Number(v) || 0 })} />
                        <NumberInput label="Lecture h/week (L)" min={0} radius="lg"
                            value={form.lecture_hours}
                            onChange={(v) => setForm({ ...form, lecture_hours: Number(v) || 0 })} />
                        <NumberInput label="Tutorial h/week (T)" min={0} radius="lg"
                            value={form.tutorial_hours}
                            onChange={(v) => setForm({ ...form, tutorial_hours: Number(v) || 0 })} />
                        <NumberInput label="Lab h/week" min={0} radius="lg"
                            value={form.lab_hours}
                            onChange={(v) => setForm({ ...form, lab_hours: Number(v) || 0 })} />
                    </Group>
                    <Select label="Course type" radius="lg" clearable
                        placeholder="Pick FIU category..."
                        value={form.course_type || null}
                        onChange={(v) => setForm({ ...form, course_type: v ?? '' })}
                        data={COURSE_TYPES}
                        description="UC = University Core . FC = Faculty Core . AC = Area Core . AE = Area Elective . FE = Faculty Elective . UE = University Elective" />
                    <MultiSelect
                        label="Prerequisites"
                        placeholder="Pick existing courses..."
                        searchable
                        radius="lg"
                        data={courses.map((c) => ({ value: c.code, label: `${c.code} - ${c.title}` }))}
                        value={form.prerequisites}
                        onChange={(v) => setForm({ ...form, prerequisites: v })}
                        description="Selected courses must already exist. Use the codes you see in the table."
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={close} radius="lg">Cancel</Button>
                        <Button onClick={handleAdd} loading={saving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}
                            disabled={!form.code || !form.title || !form.department_id}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
