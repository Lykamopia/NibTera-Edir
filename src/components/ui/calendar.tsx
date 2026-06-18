
"use client"

import * as React from "react"
import {
  Calendar as RDRCalendar,
  DateRange as RDRDateRange,
  type Range,
  type RangeKeyDict,
} from "react-date-range"

import "react-date-range/dist/styles.css"
import "react-date-range/dist/theme/default.css"
import "./calendar.css"

import { cn } from "@/lib/utils"
import type { DateRange } from "@/lib/types"

type CalendarSharedProps = {
  className?: string
  numberOfMonths?: number
  fromYear?: number
  toYear?: number
  defaultMonth?: Date
  captionLayout?: "buttons" | "dropdown" | "dropdown-buttons"
  initialFocus?: boolean
}

type CalendarRangeProps = CalendarSharedProps & {
  mode: "range"
  selected?: DateRange
  onSelect?: (value: DateRange | undefined) => void
}

type CalendarSingleProps = CalendarSharedProps & {
  mode?: "single"
  selected?: Date
  onSelect?: (value: Date | undefined) => void
}

export type CalendarProps = CalendarRangeProps | CalendarSingleProps

const RANGE_KEY = "selection"

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>((props, forwardedRef) => {
  const {
    className,
    numberOfMonths = 1,
    fromYear,
    toYear,
    defaultMonth,
    captionLayout = "dropdown-buttons",
    initialFocus,
  } = props

  const mode = props.mode ?? "single"
  const isRange = mode === "range"

  const rangeSelected = isRange ? (props.selected as DateRange | undefined) : undefined
  const singleSelected = !isRange ? (props.selected as Date | undefined) : undefined

  const onRangeSelect = isRange ? (props.onSelect as CalendarRangeProps["onSelect"]) : undefined
  const onSingleSelect = !isRange ? (props.onSelect as CalendarSingleProps["onSelect"]) : undefined

  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useImperativeHandle(forwardedRef, () => containerRef.current)

  const todayRef = React.useRef(new Date())

  const minDate = React.useMemo(() => (fromYear ? new Date(fromYear, 0, 1) : undefined), [fromYear])
  const maxDate = React.useMemo(() => (toYear ? new Date(toYear, 11, 31) : undefined), [toYear])

  const monthsToShow = Math.max(1, numberOfMonths)

  const shownDate = React.useMemo(() => {
    return defaultMonth ?? rangeSelected?.from ?? singleSelected ?? todayRef.current
  }, [defaultMonth, rangeSelected?.from, singleSelected])

  const rangeSelection = React.useMemo<Range>(() => {
    const start = rangeSelected?.from ?? shownDate
    const end = rangeSelected?.to ?? rangeSelected?.from ?? shownDate

    return {
      startDate: start,
      endDate: end,
      key: RANGE_KEY,
    }
  }, [rangeSelected?.from, rangeSelected?.to, shownDate])

  const hasRangeSelection = Boolean(rangeSelected?.from)

  const rangeColors = React.useMemo(
    () => [hasRangeSelection ? "hsl(var(--primary))" : "transparent"],
    [hasRangeSelection]
  )

  const handleRangeChange = React.useCallback(
    (ranges: RangeKeyDict) => {
      if (!onRangeSelect) {
        return
      }

      const selection = ranges[RANGE_KEY] ?? ranges.selection

      if (!selection) {
        onRangeSelect(undefined)
        return
      }

      const startDate = selection.startDate ? new Date(selection.startDate) : undefined
      const endDate = selection.endDate ? new Date(selection.endDate) : undefined

      if (!startDate) {
        onRangeSelect(undefined)
        return
      }

      onRangeSelect({ from: startDate, to: endDate ?? undefined })
    },
    [onRangeSelect]
  )

  const handleSingleChange = React.useCallback(
    (date: Date) => {
      onSingleSelect?.(date)
    },
    [onSingleSelect]
  )

  React.useEffect(() => {
    if (!initialFocus || !containerRef.current) {
      return
    }

    const target =
      containerRef.current.querySelector<HTMLButtonElement>(".rdrDay.rdrDaySelected") ??
      containerRef.current.querySelector<HTMLButtonElement>(".rdrDay.rdrDayToday")

    target?.focus()
  }, [initialFocus, hasRangeSelection, rangeSelection, singleSelected])

  return (
    <div
      className={cn("calendar-surface", className)}
      ref={containerRef}
      data-range-selected={hasRangeSelection ? "true" : "false"}
    >
      {isRange ? (
        <RDRDateRange
          key={hasRangeSelection ? "range-active" : "range-empty"}
          ranges={[rangeSelection]}
          onChange={handleRangeChange}
          months={monthsToShow}
          direction="horizontal"
          showDateDisplay={false}
          showPreview={false}
          dragSelectionEnabled={false}
          moveRangeOnFirstSelection={false}
          retainEndDateOnFirstSelection={false}
          minDate={minDate}
          maxDate={maxDate}
          shownDate={shownDate}
          showMonthAndYearPickers={captionLayout !== "buttons"}
          rangeColors={rangeColors}
          weekdayDisplayFormat=" "
        />
      ) : (
        <RDRCalendar
          key={singleSelected ? singleSelected.getTime() : shownDate.getTime()}
          date={singleSelected ?? shownDate}
          onChange={handleSingleChange}
          months={monthsToShow}
          direction="horizontal"
          minDate={minDate}
          maxDate={maxDate}
          shownDate={shownDate}
          showMonthAndYearPickers={captionLayout !== "buttons"}
          weekdayDisplayFormat=" "
          color="hsl(var(--primary))"
        />
      )}
    </div>
  )
})

Calendar.displayName = "Calendar"

export { Calendar }

    
