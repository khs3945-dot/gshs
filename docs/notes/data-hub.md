# 자료 한번에 관리 (`data-hub.html`, 관리 메뉴·관리자만)

## 처음 만듦 (2026-10-24)
- 학년도·학기마다 고칠 자료를 카드 하나씩: 상태 배지(최신/확인/없음, 학년도 선택), **현재 자료 엑셀 받기 → 올리기 → 미리 확인(줄 수·새로·바뀜·빠짐·문제 줄) → 반영**, 원래 페이지 링크. 자료 정의는 스크립트의 `D` 배열(status/export/parse/preview/apply) 한 곳.
- 저장은 기존 경로 재사용(관리자는 `verify_shared_edit_password(null)` 통과): 학교 기본 정보 `school_overview_save`, 학생 명렬 `school_students_replace`(**올린 파일에 있는 학년만** 통째로), 반 편성 `school_sections_replace`, 학사일정 `school_events_replace`, 교직원 `staff_roster_save`(이름으로 고치기/더하기, 지우지 않음), 교실 `rooms` upsert(지우지 않음), 교실 배치도 `classroom_layouts`(건물별 update/insert, 파일에 없는 건물은 삭제), 당번표 파일 날짜 범위 delete + `duty_roster_save` insert.
- **민감 비고 함정**: `trg_split_private_note`는 INSERT 때 민감 부분을 새 값으로 덮어씀 → 공개 비고만 내보냈다 다시 올리면 특수·건강 비고가 지워짐. 그래서 학생 명렬·반 편성 내보내기는 `school_private_notes_get(null)`로 **합친 비고**(학교 현황 `mergeNote`와 같은 방식)를 넣는다. 카드에 "민감 정보 포함 — 보관 주의".
- 교실 배치도 엑셀: 한 줄 = 한 칸(건물·건물 순서·줄·줄 종류(칸/구분선)·층 이름·복도·칸·이름·보조·종류) ↔ `floors` JSON 왕복.
- 링크만 있는 카드: 학생 진급, 교사 시간표(staff-edit 파일 가져오기), 시험 시간표, 업무 흐름.
- 관리자 사용 설명서 모달(`#guideModal`, `data-hub.html#guide`로 바로 열림): 새 학년도 준비 순서, 새 학기, 엑셀 규칙(통째로 바꾸기/더하고 고치기), 관리 메뉴 안내, 사이트 밖 일(Apps Script 재배포·Secrets·SQL Editor).
