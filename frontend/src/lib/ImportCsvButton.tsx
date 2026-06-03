/**
 * Inline "Import CSV" button — opens a modal with a "Download sample" link
 * plus a file picker. Used on the Departments / Courses / Lecturers pages.
 */
import { useRef, useState } from 'react';
import {
    Box, Button, Code, FileButton, Group, Modal, Stack, Text,
} from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { toast, errMsg } from './feedback';

export type ImportEntity = 'departments' | 'faculty' | 'courses' | 'rooms' | 'semesters' | 'sections' | 'prerequisites' | 'assignments';

const COLUMNS: Record<ImportEntity, string> = {
    departments: 'code, name, parent_code (optional — code of the parent Faculty if this is a sub-department)',
    faculty: 'first_name, last_name, email, department_code, rank, max_load_hours',
    courses: 'code, title, department_code, credit_hours, lecture_hours, tutorial_hours, lab_hours, curriculum_year, course_type (UC/FC/AC/AE/FE/UE), prerequisites',
    rooms: 'building_code, building_name, room_number, capacity, type, department_code (optional — owning faculty)',
    semesters: 'name, start_date, end_date, is_active',
    sections: 'course_code, semester_name, section_number, expected_enrollment',
    prerequisites: 'course_code, prerequisite_code',
    assignments: 'faculty_email, course_code, room_number (optional)',
};

const LABELS: Record<ImportEntity, string> = {
    departments: 'Departments',
    faculty: 'Lecturers',
    courses: 'Courses',
    rooms: 'Rooms',
    semesters: 'Semesters',
    sections: 'Sections',
    prerequisites: 'Prerequisites',
    assignments: 'Assignments',
};

interface Props {
    entity: ImportEntity;
    onImported?: () => void;
    label?: string;
}

export function ImportCsvButton({ entity, onImported, label }: Props) {
    const [opened, setOpened] = useState(false);
    const [busy, setBusy] = useState(false);
    const resetRef = useRef<() => void>(null);

    const downloadSample = async () => {
        try {
            const res = await apiClient.get(`/catalog/templates/${entity}.csv`, { responseType: 'blob' });
            const blob = new Blob([res.data as BlobPart], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${entity}_sample.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Sample ${entity}.csv downloaded.`);
        } catch (e) {
            toast.error(errMsg(e, 'Could not download sample.'));
        }
    };

    const upload = async (file: File | null) => {
        if (!file) return;
        setBusy(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await apiClient.post<{
                created: number; skipped: number;
                prerequisites_linked?: number;
                errors?: string[];
            }>(`/import/${entity}`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            let msg = `Imported ${res.data.created} ${entity}, skipped ${res.data.skipped}`;
            if (res.data.prerequisites_linked) {
                msg += `, ${res.data.prerequisites_linked} prerequisites linked`;
            }
            toast.success(msg);
            (res.data.errors || []).slice(0, 4).forEach((err) => toast.warn(err));
            if ((res.data.errors || []).length > 4) {
                toast.warn(`...and ${(res.data.errors!.length - 4)} more issues`);
            }
            onImported?.();
            setOpened(false);
        } catch (e) {
            toast.error(errMsg(e, 'Import failed.'));
        } finally {
            setBusy(false);
            resetRef.current?.();
        }
    };

    return (
        <>
            <Button
                variant="light"
                color="brand"
                radius="lg"
                leftSection={<IconUpload size={16} />}
                onClick={() => setOpened(true)}
            >
                {label ?? 'Import CSV'}
            </Button>

            <Modal
                opened={opened}
                onClose={() => setOpened(false)}
                title={`Import ${LABELS[entity]} CSV`}
                centered
                radius="xl"
                size="lg"
            >
                <Stack gap="md">
                    <Box>
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Expected columns</Text>
                        <Code block style={{ whiteSpace: 'normal' }}>{COLUMNS[entity]}</Code>
                    </Box>

                    <Group gap="sm">
                        <Button
                            variant="default"
                            radius="lg"
                            leftSection={<IconDownload size={16} />}
                            onClick={downloadSample}
                        >
                            Download sample CSV
                        </Button>
                        <FileButton onChange={upload} accept=".csv" resetRef={resetRef}>
                            {(props) => (
                                <Button
                                    {...props}
                                    loading={busy}
                                    radius="lg"
                                    variant="gradient"
                                    gradient={{ from: 'brand.6', to: 'sky.5' }}
                                    leftSection={<IconUpload size={16} />}
                                >
                                    Choose CSV & upload
                                </Button>
                            )}
                        </FileButton>
                    </Group>

                    <Text size="xs" c="dimmed">
                        Existing rows with matching codes/emails are skipped, not duplicated.
                    </Text>
                </Stack>
            </Modal>
        </>
    );
}
