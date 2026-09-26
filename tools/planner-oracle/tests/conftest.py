"""Shared fixtures: real dataset inputs used by the flowchart test cases."""
import pytest

import datasets as ds
from algorithm import DayContext


@pytest.fixture(scope="session")
def s1():
    return {o.ref: o for o in ds.s1_orders()}


@pytest.fixture(scope="session")
def s1_status():
    return ds.s1_status()


@pytest.fixture(scope="session")
def dec23():
    return DayContext.for_date("2025-12-23")
