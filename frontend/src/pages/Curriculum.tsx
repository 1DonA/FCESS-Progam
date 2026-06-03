/**
 * Curriculum / Graduation Plan
 *
 * Shows the full degree plan for a chosen department:
 *   One column per curriculum year (Year 1 ... Year N)
 *   Inside each year, courses are grouped by FIU category (UC/FC/AC/AE/FE/UE)
 *   Each card shows ECTS, weekly hours (L/T/Lab), prerequisites
 *   Totals at the bottom show "Credits required to graduate"
 *
 * This is the read-only view a student / academic advisor wants,
 * but admins/chairs can also add a course manually via the "+ Add Course"
 * button (or bulk-import a CSV via "+ Add Curriculum").
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Badge, Box, Button, Container, Group, Modal, NumberInput, Paper, Select,
    SimpleGrid, Skeleton, Stack, Text, TextInput, ThemeIcon, Title,
    ActionIcon, Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconCertificate, IconPrinter, IconChevronRight, IconAward, IconBook,
    IconLayersIntersect, IconPlus,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { errMsg, toast } from '../lib/feedback';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { EditRowButton } from '../lib/EditRowButton';
import { GroupsModal } from '../components/Curriculum/GroupsModal';

interface Department { id: string; code: string; name: string; }
interface Course {
    id: string; code: string; title: string;
    credit_hours: number; lecture_hours: number; lab_hours: number;
    tutorial_hours?: number;
    department_id: string; curriculum_year: number;
    semester_in_year?: number;   // 1 = Fall, 2 = Spring
    course_type?: string | null; workload?: number | null;
}

const SEMESTER_LABEL: Record<number, string> = { 1: 'Fall', 2: 'Spring' };

/** If the backend hasn't populated semester_in_year (older row), fall back
 *  to a heuristic on the course code's last digit: odd → Fall, even → Spring. */
function semOf(c: Course): 1 | 2 {
    if (c.semester_in_year === 1 || c.semester_in_year === 2) return c.semester_in_year;
    const last = (c.code.match(/(\d)\D*$/) || [, '1'])[1];
    return (parseInt(last, 10) % 2 === 0) ? 2 : 1;
}
interface Prerequisite { id: string; course_id: string; prerequisite_course_id: string; }

const TYPE_ORDER = ['UC', 'FC', 'AC', 'AE', 'FE', 'UE', 'CORE', 'ELECTIVE', 'GENERAL', 'OTHER'] as const;
const TYPE_COLOR: Record<string, string> = {
    UC: 'grape', FC: 'teal', AC: 'indigo', AE: 'yellow', FE: 'orange', UE: 'pink',
    CORE: 'teal', ELECTIVE: 'yellow', GENERAL: 'blue', OTHER: 'gray',
};
const TYPE_ABBR: Record<string, string> = {
    UC: 'UC', FC: 'FC', AC: 'AC', AE: 'AE', FE: 'FE', UE: 'UE',
    CORE: 'C', ELECTIVE: 'E', GENERAL: 'G', OTHER: 'O',
};
const TYPE_FULL_NAME: Record<string, string> = {
    UC: 'University Core', FC: 'Faculty Core', AC: 'Area Core',
    AE: 'Area Elective', FE: 'Faculty Elective', UE: 'University Elective',
    CORE: 'Core', ELECTIVE: 'Elective', GENERAL: 'General', OTHER: 'Other',
};
const COURSE_TYPE_OPTIONS = [
    { value: 'UC', label: 'University Core (UC)' },
    { value: 'FC', label: 'Faculty Core (FC)' },
    { value: 'AC', label: 'Area Core (AC)' },
    { value: 'AE', label: 'Area Elective (AE)' },
    { value: 'FE', label: 'Faculty Elective (FE)' },
    { value: 'UE', label: 'University Elective (UE)' },
];

export function Curriculum() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [prereqs, setPrereqs] = useState<Prerequisite[]>([]);
    const [deptId, setDeptId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [coverageMap, setCoverageMap] = useState<Record<string, { scheduled: number; total: number }>>({});
    const [semesterId, setSemesterId] = useState<string | null>(null);
    const [groupsModalCourse, setGroupsModalCourse] = useState<Course | null>(null);

    const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
    const [saving, setSaving] = useState(false);
    const blankCourse = {
        code: '', title: '',
        credit_hours: 3, lecture_hours: 3, tutorial_hours: 0, lab_hours: 0,
        curriculum_year: 1, semester_in_year: 1, course_type: 'FC',
    };
    const [newCourse, setNewCourse] = useState(blankCourse);

    const refreshAll = async () => {
        setLoading(true);
        try {
            const [d, c, p] = await Promise.all([
                apiClient.get<Department[]>('/catalog/departments'),
                apiClient.get<Course[]>('/catalog/courses'),
                apiClient.get<Prerequisite[]>('/catalog/prerequisites'),
            ]);
            setDepartments(d.data);
            setCourses(c.data);
            setPrereqs(p.data);
            if (d.data.length && !deptId) setDeptId(d.data[0].id);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load curriculum.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refreshAll();
        (async () => {
            try {
                const sRes = await apiClient.get('/scheduling/semesters');
                const active = (sRes.data || []).find((s: any) => s.is_active) || (sRes.data || [])[0];
                if (active) {
                    setSemesterId(active.id);
                    const covRes = await apiClient.get(`/scheduling/curriculum-coverage/${active.id}`);
                    const m: Record<string, { scheduled: number; total: number }> = {};
                    (covRes.data || []).forEach((c: any) => {
                        m[c.course_id] = { scheduled: c.scheduled_sections, total: c.section_count };
                    });
                    setCoverageMap(m);
                }
            } catch { /* coverage is optional */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const department = departments.find((d) => d.id === deptId) ?? null;

    const deptCourses = useMemo(() => {
        const base = courses.filter((c) => c.department_id === deptId);
        const q = filter.trim().toLowerCase();
        if (!q) return base;
        return base.filter((c) =>
            c.code.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q) ||
            (c.course_type ?? '').toLowerCase().includes(q),
        );
    }, [courses, deptId, filter]);

    const codeById = useMemo(() => {
        const m: Record<string, string> = {};
        courses.forEach((c) => { m[c.id] = c.code; });
        return m;
    }, [courses]);
    const prereqsByCourse = useMemo(() => {
        const m: Record<string, string[]> = {};
        prereqs.forEach((p) => {
            if (!m[p.course_id]) m[p.course_id] = [];
            m[p.course_id].push(codeById[p.prerequisite_course_id] ?? '?');
        });
        return m;
    }, [prereqs, codeById]);

    const years = useMemo(() => {
        const ys = Array.from(new Set(deptCourses.map((c) => c.curriculum_year))).sort((a, b) => a - b);
        return ys.length ? ys : [1, 2, 3, 4];
    }, [deptCourses]);

    // Group by (year, semester, course_type). Each year is rendered as TWO
    // columns: Fall (semester 1) and Spring (semester 2). Inside each
    // semester, courses are still bucketed by FIU category.
    const grouped: Record<number, Record<number, Record<string, Course[]>>> = {};
    years.forEach((y) => { grouped[y] = { 1: {}, 2: {} }; });
    deptCourses.forEach((c) => {
        const y = c.curriculum_year || 0;
        const s = semOf(c);
        const t = (c.course_type || 'OTHER').toUpperCase();
        grouped[y] = grouped[y] || { 1: {}, 2: {} };
        grouped[y][s] = grouped[y][s] || {};
        grouped[y][s][t] = grouped[y][s][t] || [];
        grouped[y][s][t].push(c);
    });

    // Per-semester ECTS + weekly hours so each semester card shows its own totals
    const ectsByYearSem:  Record<string, number> = {};
    const hoursByYearSem: Record<string, number> = {};
    deptCourses.forEach((c) => {
        const key = `${c.curriculum_year || 0}:${semOf(c)}`;
        ectsByYearSem[key]  = (ectsByYearSem[key]  || 0) + (Number(c.credit_hours)  || 0);
        hoursByYearSem[key] = (hoursByYearSem[key] || 0)
            + (Number(c.lecture_hours) || 0)
            + (Number(c.tutorial_hours) || 0)
            + (Number(c.lab_hours) || 0);
    });
    const totalEcts = Object.values(ectsByYearSem).reduce((s, n) => s + n, 0);
    const coreCount = deptCourses.filter((c) => {
        const t = (c.course_type || '').toUpperCase();
        return t === 'CORE' || t === 'FC' || t === 'AC';
    }).length;
    const electiveCount = deptCourses.filter((c) => {
        const t = (c.course_type || '').toUpperCase();
        return t === 'ELECTIVE' || t === 'AE' || t === 'FE' || t === 'UE';
    }).length;

    const handleManualAdd = async () => {
        if (!deptId) {
            toast.error('Pick a department first.');
            return;
        }
        if (!newCourse.code.trim() || !newCourse.title.trim()) {
            toast.error('Code and title are required.');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post<Course>('/catalog/courses', {
                code: newCourse.code.toUpperCase().trim(),
                title: newCourse.title.trim(),
                department_id: deptId,
                credit_hours: Number(newCourse.credit_hours) || 0,
                lecture_hours: Number(newCourse.lecture_hours) || 0,
                tutorial_hours: Number(newCourse.tutorial_hours) || 0,
                lab_hours: Number(newCourse.lab_hours) || 0,
                curriculum_year: Number(newCourse.curriculum_year) || 1,
                semester_in_year: Number(newCourse.semester_in_year) === 2 ? 2 : 1,
                course_type: newCourse.course_type || null,
            });
            toast.success(`Added ${newCourse.code.toUpperCase().trim()} to ${department?.code} curriculum.`);
            setNewCourse(blankCourse);
            closeAdd();
            void refreshAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not add course.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconCertificate size={24} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Degree Plan</Text>
                                    <Title order={2}>Curriculum and Graduation Plan</Title>
                                    <Text size="xs" c="dimmed">Add courses one by one or bulk-import a CSV.</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <Select
                                    placeholder="Pick a department..."
                                    value={deptId}
                                    onChange={setDeptId}
                                    data={departments.map((d) => ({ value: d.id, label: `${d.code} - ${d.name}` }))}
                                    searchable
                                    radius="lg"
                                    style={{ minWidth: 260 }}
                                />
                                <Button
                                    leftSection={<IconPlus size={16} />}
                                    onClick={openAdd}
                                    disabled={!deptId}
                                    variant="gradient"
                                    gradient={{ from: 'brand.6', to: 'sky.5' }}
                                    radius="lg">
                                    Add Course
                                </Button>
                                <ImportCsvButton entity="courses" label="+ Add Curriculum" onImported={refreshAll} />
                                <Button variant="light" radius="lg"
                                    leftSection={<IconPrinter size={16} />}
                                    onClick={() => window.print()}>
                                    Print
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    {department && (
                        <Paper p="md" radius="xl" withBorder shadow="sm">
                            <Group justify="space-between" wrap="wrap">
                                <Group gap="lg" wrap="wrap">
                                    <Stat label="Department" value={`${department.code} - ${department.name}`} />
                                    <Stat label="Total courses" value={String(deptCourses.length)} />
                                    <Stat label="Core (FC+AC)" value={String(coreCount)} />
                                    <Stat label="Electives (AE+FE+UE)" value={String(electiveCount)} />
                                    <Stat label="Years" value={String(years.length)} />
                                </Group>
                                <Group gap="xs">
                                    <ThemeIcon size={32} radius="xl" color="teal" variant="light">
                                        <IconAward size={18} />
                                    </ThemeIcon>
                                    <Box>
                                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>To graduate</Text>
                                        <Text fw={700} size="lg">{totalEcts} credits</Text>
                                    </Box>
                                </Group>
                            </Group>
                        </Paper>
                    )}

                    {department && (
                        <TextInput
                            placeholder="Filter courses by code, title, or type..."
                            value={filter}
                            onChange={(e) => setFilter(e.currentTarget.value)}
                            radius="lg"
                            style={{ maxWidth: 420 }}
                        />
                    )}

                    {loading ? (
                        <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }} spacing="md">
                            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={220} radius="md" />)}
                        </SimpleGrid>
                    ) : !department ? (
                        <Text c="dimmed" ta="center" py="xl">Pick a department to view its curriculum.</Text>
                    ) : deptCourses.length === 0 ? (
                        <Stack align="center" py="xl" gap="sm">
                            <Text c="dimmed">{department.code} doesn't have any courses yet.</Text>
                            <Group gap="xs">
                                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openAdd}>
                                    Add your first course
                                </Button>
                                <Text size="xs" c="dimmed">or use <strong>+ Add Curriculum</strong> to bulk-import a CSV.</Text>
                            </Group>
                        </Stack>
                    ) : (
                        <Stack gap="lg">
                            {years.map((year) => {
                                // Two cards per year, one per semester (Fall + Spring).
                                return (
                                    <Box key={year}>
                                        <Title order={3} mb="xs">Year {year}</Title>
                                        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                                            {[1, 2].map((sem) => {
                                                const semKey = `${year}:${sem}`;
                                                const semCourses = deptCourses.filter((c) => c.curriculum_year === year && semOf(c) === sem);
                                                return (
                                                    <Paper key={sem} p="md" radius="xl" withBorder shadow="sm">
                                                        <Group justify="space-between" mb={6} wrap="wrap">
                                                            <Group gap={6}>
                                                                <Badge color={sem === 1 ? 'orange' : 'cyan'} variant="filled" radius="sm" size="md">
                                                                    Semester {sem} - {SEMESTER_LABEL[sem]}
                                                                </Badge>
                                                            </Group>
                                                            <Group gap={4}>
                                                                <Badge color="brand" variant="light" radius="sm">{ectsByYearSem[semKey] || 0} credits</Badge>
                                                                <Badge color="gray" variant="light" radius="sm">{hoursByYearSem[semKey] || 0} h/week</Badge>
                                                            </Group>
                                                        </Group>
                                                        <Text size="xs" c="dimmed" mb="sm">
                                                            {semCourses.length} course{semCourses.length === 1 ? '' : 's'}
                                                            {semesterId ? (() => {
                                                                const sched = semCourses.reduce((s, c) => s + (coverageMap[c.id]?.scheduled || 0), 0);
                                                                const tot   = semCourses.reduce((s, c) => s + (coverageMap[c.id]?.total || 0), 0);
                                                                return tot ? ` - ${sched}/${tot} sections scheduled` : '';
                                                            })() : ''}
                                                        </Text>
                                                        {semCourses.length === 0 ? (
                                                            <Text c="dimmed" size="xs">no courses defined for this semester</Text>
                                                        ) : (
                                                            <Stack gap="sm">
                                                                {TYPE_ORDER.map((t) => {
                                                                    const list = (grouped[year]?.[sem]?.[t] || []);
                                                                    if (list.length === 0) return null;
                                                                    return (
                                                                        <Box key={t}>
                                                                            <Group gap={6} mb={4}>
                                                                                <IconBook size={12} stroke={2.5} color="#475569" />
                                                                                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '.05em' }}>
                                                                                    {TYPE_FULL_NAME[t] || t} ({TYPE_ABBR[t] || t})
                                                                                </Text>
                                                                                <Text size="xs" c="dimmed">- {list.length}</Text>
                                                                            </Group>
                                                                            <Stack gap={6}>
                                                                                {list.map((c) => {
                                                                                    const reqs = prereqsByCourse[c.id] || [];
                                                                                    return (
                                                                                        <Box key={c.id} style={{
                                                                                            padding: '8px 10px',
                                                                                            border: '1px solid #e2e8f0',
                                                                                            borderRadius: 10,
                                                                                            background: 'rgba(248,250,252,0.7)',
                                                                                        }}>
                                                                                            <Group justify="space-between" gap={6} wrap="nowrap">
                                                                                                <Box style={{ minWidth: 0 }}>
                                                                                                    <Group gap={4}>
                                                                                                        <Text fw={700} size="sm">{c.code}</Text>
                                                                                                        <Badge size="xs" variant="light" color={TYPE_COLOR[t] || 'gray'} title={TYPE_FULL_NAME[t] || t}>
                                                                                                            {TYPE_ABBR[t] || t}
                                                                                                        </Badge>
                                                                                                        <Tooltip label="Manage groups (lectures/labs/tutorials)">
                                                                                                            <ActionIcon size="xs" variant="subtle" color="brand"
                                                                                                                onClick={() => setGroupsModalCourse(c)}>
                                                                                                                <IconLayersIntersect size={13} />
                                                                                                            </ActionIcon>
                                                                                                        </Tooltip>
                                                                                                        <EditRowButton
                                                                                                            title={`Edit ${c.code}`}
                                                                                                            endpoint={`/catalog/courses/${c.id}`}
                                                                                                            onSaved={refreshAll}
                                                                                                            fields={[
                                                                                                                { name: 'code',  label: 'Code',  value: c.code },
                                                                                                                { name: 'title', label: 'Title', value: c.title },
                                                                                                                { kind: 'number', name: 'credit_hours',    label: 'Credit hours',         value: Number(c.credit_hours),         min: 0, step: 0.5 },
                                                                                                                { kind: 'number', name: 'lecture_hours',   label: 'Lecture hours (L)',    value: Number(c.lecture_hours),        min: 0, step: 1 },
                                                                                                                { kind: 'number', name: 'tutorial_hours',  label: 'Tutorial hours (T)',   value: Number(c.tutorial_hours ?? 0),  min: 0, step: 1 },
                                                                                                                { kind: 'number', name: 'lab_hours',       label: 'Lab/Practical hours',  value: Number(c.lab_hours),            min: 0, step: 1 },
                                                                                                                { kind: 'number', name: 'curriculum_year', label: 'Curriculum year',      value: Number(c.curriculum_year),      min: 1, step: 1 },
                                                                                                                { kind: 'select', name: 'semester_in_year', label: 'Semester',
                                                                                                                    value: String(semOf(c)),
                                                                                                                    options: [
                                                                                                                        { value: '1', label: 'Semester 1 - Fall' },
                                                                                                                        { value: '2', label: 'Semester 2 - Spring' },
                                                                                                                    ] },
                                                                                                                { kind: 'select', name: 'course_type', label: 'Course type', value: (c.course_type || '').toUpperCase() || 'FC',
                                                                                                                    options: COURSE_TYPE_OPTIONS },
                                                                                                            ]}
                                                                                                        />
                                                                                                    </Group>
                                                                                                    <Text size="xs" c="dimmed" truncate>{c.title}</Text>
                                                                                                </Box>
                                                                                                <Stack gap={0} align="end" style={{ minWidth: 'fit-content' }}>
                                                                                                    <Badge size="xs" variant="light" color="indigo">{c.credit_hours} cr</Badge>
                                                                                                    <Text size="xs" c="dimmed">
                                                                                                        {c.lecture_hours}L / {c.tutorial_hours ?? 0}T / {c.lab_hours}Lab
                                                                                                    </Text>
                                                                                                    {coverageMap[c.id] && coverageMap[c.id].total > 0 && (
                                                                                                        <Badge size="xs" variant="light"
                                                                                                            color={coverageMap[c.id].scheduled === coverageMap[c.id].total ? 'teal' :
                                                                                                                   coverageMap[c.id].scheduled > 0 ? 'orange' : 'red'}>
                                                                                                            {coverageMap[c.id].scheduled}/{coverageMap[c.id].total} sched.
                                                                                                        </Badge>
                                                                                                    )}
                                                                                                </Stack>
                                                                                            </Group>
                                                                                            {reqs.length > 0 && (
                                                                                                <Group gap={4} mt={4}>
                                                                                                    <IconChevronRight size={12} color="#94a3b8" />
                                                                                                    <Text size="xs" c="dimmed">needs</Text>
                                                                                                    {reqs.map((r) => (
                                                                                                        <Badge key={r} size="xs" variant="default" radius="sm">{r}</Badge>
                                                                                                    ))}
                                                                                                </Group>
                                                                                            )}
                                                                                        </Box>
                                                                                    );
                                                                                })}
                                                                            </Stack>
                                                                        </Box>
                                                                    );
                                                                })}
                                                            </Stack>
                                                        )}
                                                    </Paper>
                                                );
                                            })}
                                        </SimpleGrid>
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                </Stack>
            </Container>

            <GroupsModal
                opened={!!groupsModalCourse}
                onClose={() => setGroupsModalCourse(null)}
                courseId={groupsModalCourse?.id || ''}
                courseCode={groupsModalCourse?.code || ''}
                courseDepartmentId={groupsModalCourse?.department_id || ''}
                onChanged={refreshAll}
            />

            <Modal opened={addOpened} onClose={closeAdd} title={`Add course to ${department?.code ?? ''} curriculum`} size="lg" radius="xl" centered>
                <Stack gap="md">
                    <Group grow>
                        <TextInput label="Code" placeholder="e.g. CMPE201" required radius="lg"
                            value={newCourse.code}
                            onChange={(e) => setNewCourse({ ...newCourse, code: e.target.value })} />
                        <TextInput label="Title" placeholder="e.g. Digital Logic Design" required radius="lg"
                            value={newCourse.title}
                            onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })} />
                    </Group>
                    <Group grow>
                        <NumberInput label="Curriculum year" min={1} max={6} radius="lg"
                            value={newCourse.curriculum_year}
                            onChange={(v) => setNewCourse({ ...newCourse, curriculum_year: Number(v) || 1 })} />
                        <Select label="Semester" radius="lg"
                            value={String(newCourse.semester_in_year)}
                            onChange={(v) => setNewCourse({ ...newCourse, semester_in_year: v === '2' ? 2 : 1 })}
                            data={[
                                { value: '1', label: 'Semester 1 - Fall' },
                                { value: '2', label: 'Semester 2 - Spring' },
                            ]}
                        />
                        <NumberInput label="Credits (ECTS)" step={0.5} min={0} radius="lg"
                            value={newCourse.credit_hours}
                            onChange={(v) => setNewCourse({ ...newCourse, credit_hours: Number(v) || 0 })} />
                    </Group>
                    <Group grow>
                        <NumberInput label="Lecture h/week (L)" min={0} radius="lg"
                            value={newCourse.lecture_hours}
                            onChange={(v) => setNewCourse({ ...newCourse, lecture_hours: Number(v) || 0 })} />
                        <NumberInput label="Tutorial h/week (T)" min={0} radius="lg"
                            value={newCourse.tutorial_hours}
                            onChange={(v) => setNewCourse({ ...newCourse, tutorial_hours: Number(v) || 0 })} />
                        <NumberInput label="Lab h/week" min={0} radius="lg"
                            value={newCourse.lab_hours}
                            onChange={(v) => setNewCourse({ ...newCourse, lab_hours: Number(v) || 0 })} />
                    </Group>
                    <Select
                        label="Course type"
                        placeholder="Pick FIU category..."
                        radius="lg"
                        value={newCourse.course_type}
                        onChange={(v) => setNewCourse({ ...newCourse, course_type: v ?? 'FC' })}
                        data={COURSE_TYPE_OPTIONS}
                        description="UC = University Core . FC = Faculty Core . AC = Area Core . AE = Area Elective . FE = Faculty Elective . UE = University Elective"
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" radius="lg" onClick={closeAdd}>Cancel</Button>
                        <Button onClick={handleManualAdd} loading={saving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}
                            disabled={!newCourse.code || !newCourse.title}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
            <Text fw={600}>{value}</Text>
        </Box>
    );
}
